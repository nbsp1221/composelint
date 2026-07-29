import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findComposeFiles, resolveTargets } from "../src/cli/discover.js";
import { collectIncludedPaths } from "../src/cli/includes.js";
import { DEFAULT_EXCLUDE, DEFAULT_PARTIALS } from "../src/config/defaults.js";
import { createPathMatcher } from "../src/config/glob.js";
import { resolveConfig } from "../src/config/loader.js";
import { lintSource } from "../src/core/linter.js";
import { allRules } from "../src/rules/index.js";

const config = resolveConfig({});

/** Lints with the shared configuration, optionally as a partial file. */
function ruleIds(source: string, partial = false): string[] {
  return [
    ...new Set(
      lintSource(source, "compose.yaml", allRules, config, {
        partial,
      }).result.diagnostics.map((d) => d.ruleId),
    ),
  ].sort();
}

let dir: string;
let cwd: string;
const isExcluded = () => createPathMatcher(DEFAULT_EXCLUDE, dir);

beforeEach(async () => {
  cwd = process.cwd();
  dir = await mkdtemp(join(tmpdir(), "composelint-fs-"));
  process.chdir(dir);
});

afterEach(async () => {
  process.chdir(cwd);
  await chmod(dir, 0o755).catch(() => {});
});

async function write(name: string): Promise<void> {
  const target = join(dir, name);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, "services: {}\n", "utf-8");
}

describe("createPathMatcher", () => {
  const base = "/project";

  it("matches an exact file path", () => {
    const isExcluded = createPathMatcher(["compose.yaml"], base);
    expect(isExcluded("/project/compose.yaml")).toBe(true);
    expect(isExcluded("/project/sub/compose.yaml")).toBe(false);
  });

  it("matches nested files with a globstar", () => {
    const isExcluded = createPathMatcher(["**/compose.yaml"], base);
    expect(isExcluded("/project/compose.yaml")).toBe(true);
    expect(isExcluded("/project/sub/compose.yaml")).toBe(true);
  });

  it("treats a directory pattern as everything inside it", () => {
    for (const pattern of ["examples", "examples/", "examples/**"]) {
      const isExcluded = createPathMatcher([pattern], base);
      expect(isExcluded("/project/examples/compose.yaml")).toBe(true);
      expect(isExcluded("/project/examples/a/b/compose.yaml")).toBe(true);
      expect(isExcluded("/project/compose.yaml")).toBe(false);
    }
  });

  it("re-includes paths with a negated pattern, last match winning", () => {
    const isExcluded = createPathMatcher(
      ["examples/**", "!examples/keep/**"],
      base,
    );
    expect(isExcluded("/project/examples/compose.yaml")).toBe(true);
    expect(isExcluded("/project/examples/keep/compose.yaml")).toBe(false);
  });

  it("matches dotfile directories", () => {
    const isExcluded = createPathMatcher(["**/.cache"], base);
    expect(isExcluded("/project/.cache/compose.yaml")).toBe(true);
  });

  it("never excludes paths outside the base directory", () => {
    const isExcluded = createPathMatcher(["**"], base);
    expect(isExcluded("/elsewhere/compose.yaml")).toBe(false);
  });

  it("ignores empty patterns", () => {
    const isExcluded = createPathMatcher(["", "   "], base);
    expect(isExcluded("/project/compose.yaml")).toBe(false);
  });
});

describe("exclude configuration", () => {
  it("keeps default excludes when none are configured", () => {
    expect(resolveConfig({}).exclude).toEqual(DEFAULT_EXCLUDE);
  });

  it("appends user patterns after the defaults", () => {
    const config = resolveConfig({ exclude: ["examples/**"] });
    expect(config.exclude).toEqual([...DEFAULT_EXCLUDE, "examples/**"]);
    expect(config.warnings).toEqual([]);
  });

  it("warns and falls back when exclude is not an array", () => {
    const config = resolveConfig({
      exclude: "examples" as unknown as string[],
    });
    expect(config.exclude).toEqual(DEFAULT_EXCLUDE);
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain('"exclude" must be an array');
  });

  it("warns about non-string entries", () => {
    const config = resolveConfig({
      exclude: ["ok/**", 42 as unknown as string],
    });
    expect(config.exclude).toEqual([...DEFAULT_EXCLUDE, "ok/**"]);
    expect(config.warnings[0]).toContain("is not a string");
  });
});

describe("file discovery", () => {
  let dir: string;
  let cwd: string;

  beforeEach(async () => {
    cwd = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "composelint-"));
    await mkdir(join(dir, "examples"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "compose.yaml"), "services: {}\n");
    await writeFile(join(dir, "docker-compose.override.yml"), "services: {}\n");
    await writeFile(join(dir, "examples", "compose.yaml"), "services: {}\n");
    await writeFile(
      join(dir, "node_modules", "pkg", "compose.yaml"),
      "services: {}\n",
    );
    await writeFile(join(dir, "not-compose.yaml"), "services: {}\n");
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  it("finds compose files recursively and skips default excludes", async () => {
    const isExcluded = createPathMatcher(DEFAULT_EXCLUDE, dir);
    expect(await findComposeFiles(".", isExcluded)).toEqual([
      "compose.yaml",
      "docker-compose.override.yml",
      "examples/compose.yaml",
    ]);
  });

  it("applies user exclude patterns during discovery", async () => {
    const isExcluded = createPathMatcher(
      [...DEFAULT_EXCLUDE, "examples/**", "**/*.override.yml"],
      dir,
    );
    expect(await resolveTargets([], isExcluded)).toEqual({
      files: ["compose.yaml"],
      skipped: [],
      missing: [],
    });
  });

  it("reports explicitly named files that are excluded", async () => {
    const isExcluded = createPathMatcher(["examples/**"], dir);
    const result = await resolveTargets(
      ["compose.yaml", "examples/compose.yaml"],
      isExcluded,
    );
    expect(result.files).toEqual(["compose.yaml"]);
    expect(result.skipped).toEqual(["examples/compose.yaml"]);
  });

  it("reports missing targets", async () => {
    const isExcluded = createPathMatcher([], dir);
    const result = await resolveTargets(["nope.yaml"], isExcluded);
    expect(result.missing).toEqual(["nope.yaml"]);
    expect(result.files).toEqual([]);
  });
});

describe("which file names count as Compose files", () => {
  it("finds the names Compose itself looks for", async () => {
    for (const name of [
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
    ]) {
      await write(name);
    }
    expect(await findComposeFiles(".", isExcluded())).toEqual([
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
    ]);
  });

  it("finds both conventions for environment-specific files", async () => {
    for (const name of [
      "compose.prod.yaml",
      "compose.override.yml",
      "docker-compose.prod.yaml",
      "prod.compose.yaml",
      "dev.compose.yml",
      "dev.docker-compose.yaml",
    ]) {
      await write(name);
    }
    expect(await findComposeFiles(".", isExcluded())).toHaveLength(6);
  });

  it("ignores files that are not Compose files", async () => {
    for (const name of [
      "stack.yaml",
      "values.yml",
      "compose.yaml.bak",
      "composer.yaml",
      "README.md",
    ]) {
      await write(name);
    }
    expect(await findComposeFiles(".", isExcluded())).toEqual([]);
  });

  it("lints a file that is named freely when it is passed explicitly", async () => {
    await write("anything.yaml");
    const result = await resolveTargets(["anything.yaml"], isExcluded());
    expect(result.files).toEqual(["anything.yaml"]);
  });
});

describe("targets that point at the same file", () => {
  it("lints a file once when spelled two ways", async () => {
    await write("compose.yaml");
    const result = await resolveTargets(
      ["compose.yaml", "./compose.yaml"],
      isExcluded(),
    );
    expect(result.files).toEqual(["compose.yaml"]);
  });

  it("lints a file once when a directory also contains it", async () => {
    await write("compose.yaml");
    const result = await resolveTargets([".", "compose.yaml"], isExcluded());
    expect(result.files).toEqual(["compose.yaml"]);
  });

  it("reports a missing target once per spelling", async () => {
    const result = await resolveTargets(["nope.yaml"], isExcluded());
    expect(result.missing).toEqual(["nope.yaml"]);
    expect(result.files).toEqual([]);
  });
});

describe("links", () => {
  it("follows a symlink to a Compose file", async () => {
    await write("real.yaml");
    await symlink("real.yaml", join(dir, "compose.yaml"));
    const result = await resolveTargets(["compose.yaml"], isExcluded());
    expect(result.files).toEqual(["compose.yaml"]);
    expect(await readFile(join(dir, "compose.yaml"), "utf-8")).toBe(
      "services: {}\n",
    );
  });

  it("treats a broken symlink as missing", async () => {
    await symlink("gone.yaml", join(dir, "compose.yaml"));
    const result = await resolveTargets(["compose.yaml"], isExcluded());
    expect(result.missing).toEqual(["compose.yaml"]);
  });
});

describe("directories", () => {
  it("walks nested directories", async () => {
    await write("compose.yaml");
    await write(join("stacks", "api", "compose.yaml"));
    expect(await findComposeFiles(".", isExcluded())).toEqual([
      "compose.yaml",
      join("stacks", "api", "compose.yaml"),
    ]);
  });

  it("skips a directory it cannot read", async () => {
    await write("compose.yaml");
    await mkdir(join(dir, "locked"));
    await write(join("locked", "compose.yaml"));
    await chmod(join(dir, "locked"), 0o000);

    const found = await findComposeFiles(".", isExcluded());
    await chmod(join(dir, "locked"), 0o755);

    expect(found).toEqual(["compose.yaml"]);
  });

  it("does not choke on a directory named like a Compose file", async () => {
    await write(join("compose.yaml", "compose.yaml"));
    expect(await findComposeFiles(".", isExcluded())).toEqual([
      join("compose.yaml", "compose.yaml"),
    ]);
  });

  it("handles paths with spaces and non-ASCII characters", async () => {
    await write(join("스택 하나", "compose.yaml"));
    expect(await findComposeFiles(".", isExcluded())).toEqual([
      join("스택 하나", "compose.yaml"),
    ]);
  });
});

describe("partial files", () => {
  const override = [
    "services:",
    "  api:",
    '    command: ["sleep", "infinity"]',
    "    environment:",
    '      DEBUG: "1"',
    "",
  ].join("\n");

  it("reports project-wide rules for a complete file", () => {
    expect(ruleIds(override)).toEqual(["require-healthcheck", "require-name"]);
  });

  it("skips project-wide rules for a partial file", () => {
    expect(ruleIds(override, true)).toEqual([]);
  });

  it("still checks everything else in a partial file", () => {
    const source = [
      "services:",
      "  api:",
      "    ports:",
      '      - "3000:3000"',
      "    image: nginx",
      "    typo_key: 1",
      "",
    ].join("\n");
    expect(ruleIds(source, true)).toEqual([
      "image-require-tag",
      "no-unbound-ports",
      "service-key-order",
      "spec-schema",
    ]);
  });

  it("marks only require-name and require-healthcheck as project-wide", () => {
    const flagged = allRules
      .filter((rule) => rule.meta.requiresFullProject)
      .map((rule) => rule.meta.name)
      .sort();
    expect(flagged).toEqual(["require-healthcheck", "require-name"]);
  });
});

describe("included fragments", () => {
  it("collects string and object include entries", () => {
    const included = collectIncludedPaths([
      {
        filePath: "/project/compose.yaml",
        source: [
          "include:",
          "  - ./fragments/db.yaml",
          "  - path: ./fragments/cache.yaml",
          "  - path:",
          "      - ./fragments/queue.yaml",
          "      - ./fragments/queue.override.yaml",
          "services:",
          "  web:",
          "    image: nginx:1.27",
          "",
        ].join("\n"),
      },
    ]);

    expect([...included].sort()).toEqual([
      "/project/fragments/cache.yaml",
      "/project/fragments/db.yaml",
      "/project/fragments/queue.override.yaml",
      "/project/fragments/queue.yaml",
    ]);
  });

  it("resolves paths relative to the including file", () => {
    const included = collectIncludedPaths([
      {
        filePath: "/project/stacks/compose.yaml",
        source: "include:\n  - ../shared/base.yaml\n",
      },
    ]);
    expect([...included]).toEqual(["/project/shared/base.yaml"]);
  });

  it("ignores files without an include list", () => {
    expect(
      collectIncludedPaths([
        {
          filePath: "/project/compose.yaml",
          source: "services:\n  web:\n    image: nginx:1.27\n",
        },
      ]).size,
    ).toBe(0);
  });

  it("survives an unparseable file", () => {
    expect(
      collectIncludedPaths([
        {
          filePath: "/project/broken.yaml",
          source: "services:\n  web:\n  a: [\n",
        },
      ]).size,
    ).toBe(0);
  });
});

describe("partial file detection", () => {
  const isPartial = createPathMatcher(DEFAULT_PARTIALS, "/project");

  it("recognises the documented override conventions", () => {
    for (const file of [
      "/project/compose.override.yaml",
      "/project/compose.override.yml",
      "/project/docker-compose.override.yaml",
      "/project/stack.override.yml",
      "/project/nested/compose.override.yaml",
    ]) {
      expect(isPartial(file), file).toBe(true);
    }
  });

  it("does not treat regular compose files as partial", () => {
    for (const file of [
      "/project/compose.yaml",
      "/project/docker-compose.yml",
      "/project/compose.prod.yaml",
    ]) {
      expect(isPartial(file), file).toBe(false);
    }
  });

  it("accepts extra patterns from the configuration", () => {
    const configured = resolveConfig({ partials: ["fragments/**"] });
    expect(configured.partials).toEqual([...DEFAULT_PARTIALS, "fragments/**"]);
    const matcher = createPathMatcher(configured.partials, "/project");
    expect(matcher("/project/fragments/db.yaml")).toBe(true);
  });

  it("warns when partials is not an array of strings", () => {
    const bad = resolveConfig({ partials: "fragments" as unknown as string[] });
    expect(bad.partials).toEqual(DEFAULT_PARTIALS);
    expect(bad.warnings[0]).toContain('"partials" must be an array');
  });
});
