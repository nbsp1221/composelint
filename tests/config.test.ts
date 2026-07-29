import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EXCLUDE, DEFAULT_PARTIALS } from "../src/config/defaults.js";
import {
  loadConfig,
  type RawConfig,
  resolveConfig,
} from "../src/config/loader.js";
import { presets } from "../src/config/presets.js";
import { lintSource } from "../src/core/linter.js";
import { allRules } from "../src/rules/index.js";
import { DEFAULT_SERVICE_KEY_ORDER } from "../src/rules/style/key-order.js";

/** A file whose service keys are in the wrong order for the default ordering. */
const OUT_OF_ORDER = [
  "name: qa",
  "services:",
  "  web:",
  "    ports:",
  '      - "127.0.0.1:80:80"',
  "    image: nginx:1.27",
  '    healthcheck: { test: ["CMD", "true"] }',
  "",
].join("\n");

function ruleIds(config: ReturnType<typeof resolveConfig>): string[] {
  return lintSource(
    OUT_OF_ORDER,
    "compose.yaml",
    allRules,
    config,
  ).result.diagnostics.map((d) => d.ruleId);
}

function bad(raw: unknown): ReturnType<typeof resolveConfig> {
  return resolveConfig(raw as RawConfig);
}

describe("presets", () => {
  it("provides exactly recommended and strict", () => {
    expect(Object.keys(presets)).toEqual(["recommended", "strict"]);
  });

  it("covers every rule in every preset", () => {
    for (const [name, preset] of Object.entries(presets)) {
      for (const rule of allRules) {
        expect(
          preset[rule.meta.name],
          `${name} is missing ${rule.meta.name}`,
        ).toBeDefined();
      }
      expect(Object.keys(preset)).toHaveLength(allRules.length);
    }
  });

  it("recommended mirrors each rule's declared default severity", () => {
    for (const rule of allRules) {
      expect(presets.recommended[rule.meta.name]).toBe(
        rule.meta.defaultSeverity,
      );
    }
  });

  it("strict sets all rules to error", () => {
    for (const severity of Object.values(presets.strict)) {
      expect(severity).toBe("error");
    }
  });

  it("never disables a rule through a preset", () => {
    for (const preset of Object.values(presets)) {
      for (const severity of Object.values(preset)) {
        expect(severity).not.toBe("off");
      }
    }
  });
});

describe("resolveConfig", () => {
  it("defaults to recommended preset", () => {
    const config = resolveConfig({});
    expect(config.rules.get("no-version-field")?.severity).toBe("error");
    expect(config.rules.get("top-level-order")?.severity).toBe("warn");
  });

  it("applies preset override", () => {
    const config = resolveConfig({}, "strict");
    expect(config.rules.get("top-level-order")?.severity).toBe("error");
    expect(config.rules.get("require-healthcheck")?.severity).toBe("error");
  });

  it("applies user rule overrides", () => {
    const config = resolveConfig({
      rules: {
        "top-level-order": "off",
        "no-privileged": { severity: "error" },
        "image-require-tag": {
          severity: "error",
          options: { forbiddenTags: ["edge"] },
        },
      },
    });
    expect(config.rules.get("top-level-order")?.severity).toBe("off");
    expect(config.rules.get("no-privileged")?.severity).toBe("error");
    expect(
      config.rules.get("image-require-tag")?.options.forbiddenTags,
    ).toEqual(["edge"]);
    expect(config.warnings).toEqual([]);
  });

  it("promotes a warning to an error and turns an error off", () => {
    const config = resolveConfig({
      rules: { "no-unbound-ports": "error", "no-version-field": "off" },
    });
    expect(config.rules.get("no-unbound-ports")?.severity).toBe("error");
    expect(config.rules.get("no-version-field")?.severity).toBe("off");
    expect(config.warnings).toEqual([]);
  });

  it("accepts rule names as keys", () => {
    const config = resolveConfig({
      rules: { "no-unbound-ports": "error", "require-healthcheck": "off" },
    });
    expect(config.rules.get("no-unbound-ports")?.severity).toBe("error");
    expect(config.rules.get("require-healthcheck")?.severity).toBe("off");
    expect(config.warnings).toEqual([]);
  });

  it("accepts numeric severities", () => {
    const config = resolveConfig({
      rules: {
        "top-level-order": 0,
        "service-key-order": 1,
        "no-privileged": 2,
      },
    });
    expect(config.rules.get("top-level-order")?.severity).toBe("off");
    expect(config.rules.get("service-key-order")?.severity).toBe("warn");
    expect(config.rules.get("no-privileged")?.severity).toBe("error");
  });

  it("accepts the [severity, options] tuple form", () => {
    const config = resolveConfig({
      rules: { "top-level-order": ["error", { order: ["services", "name"] }] },
    });
    expect(config.rules.get("top-level-order")?.severity).toBe("error");
    expect(config.rules.get("top-level-order")?.options.order).toEqual([
      "services",
      "name",
    ]);
  });

  it("keeps preset severities for rules that are not overridden", () => {
    const config = resolveConfig(
      { rules: { "top-level-order": "warn" } },
      "strict",
    );
    expect(config.rules.get("top-level-order")?.severity).toBe("warn");
    expect(config.rules.get("spec-schema")?.severity).toBe("error");
  });

  it("warns about unknown rule keys", () => {
    const config = resolveConfig({
      rules: { "no-such-rule": "error" } as Record<string, "error">,
    });
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain('Unknown rule "no-such-rule"');
  });

  it("warns about invalid severities and keeps the preset value", () => {
    const config = resolveConfig({
      rules: { "top-level-order": "fatal" as unknown as "error" },
    });
    expect(config.rules.get("top-level-order")?.severity).toBe("warn");
    expect(config.warnings[0]).toContain("invalid severity");
  });

  it("warns about an unknown preset and falls back to recommended", () => {
    const config = resolveConfig({}, "everything" as "strict");
    expect(config.rules.get("no-version-field")?.severity).toBe("error");
    expect(config.rules.get("top-level-order")?.severity).toBe("warn");
    expect(config.warnings[0]).toContain('Unknown preset "everything"');
  });
});

describe("loadConfig", () => {
  let dir: string;
  let cwd: string;

  beforeEach(async () => {
    cwd = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "composelint-config-"));
    await mkdir(join(dir, "packages", "app"), { recursive: true });
    await writeFile(join(dir, "package.json"), '{ "name": "root" }\n');
    await writeFile(
      join(dir, ".composelintrc.json"),
      JSON.stringify({
        rules: { "top-level-order": "error" },
        exclude: ["examples/**"],
      }),
    );
  });

  afterEach(() => {
    process.chdir(cwd);
  });

  it("finds the project config from a subdirectory", async () => {
    process.chdir(join(dir, "packages", "app"));
    const { config, filepath } = await loadConfig();
    expect(filepath).toBe(join(dir, ".composelintrc.json"));
    expect(resolveConfig(config).rules.get("top-level-order")?.severity).toBe(
      "error",
    );
    expect(resolveConfig(config).exclude).toContain("examples/**");
  });

  it("loads an explicit config path", async () => {
    process.chdir(dir);
    const { config, filepath } = await loadConfig(
      join(dir, ".composelintrc.json"),
    );
    expect(filepath).toBe(join(dir, ".composelintrc.json"));
    expect(config.rules?.["top-level-order"]).toBe("error");
  });

  it("returns an empty config when none exists", async () => {
    const empty = await mkdtemp(join(tmpdir(), "composelint-empty-"));
    await writeFile(join(empty, "package.json"), '{ "name": "empty" }\n');
    process.chdir(empty);
    const { config, filepath } = await loadConfig();
    expect(config).toEqual({});
    expect(filepath).toBeUndefined();
  });
});

describe("configuration shape", () => {
  it("rejects a configuration that is not a mapping", () => {
    for (const value of ["hello", [1, 2, 3], 42, true]) {
      const config = bad(value);
      expect(config.warnings[0]).toContain("Configuration must be a mapping");
      expect(config.exclude).toEqual(DEFAULT_EXCLUDE);
      expect(config.partials).toEqual(DEFAULT_PARTIALS);
      expect(config.rules.get("no-version-field")?.severity).toBe("error");
    }
  });

  it("reports a mistyped top-level key", () => {
    const config = bad({ excludes: ["examples/**"], rulez: {} });
    expect(config.warnings).toEqual([
      'Unknown configuration key "excludes" — ignored.',
      'Unknown configuration key "rulez" — ignored.',
    ]);
  });

  it("accepts every documented top-level key without complaint", () => {
    const config = resolveConfig({
      preset: "strict",
      rules: { "top-level-order": "off" },
      exclude: ["examples/**"],
      partials: ["fragments/**"],
    });
    expect(config.warnings).toEqual([]);
  });

  it("rejects a rules value that is not a mapping", () => {
    for (const value of [["top-level-order"], "top-level-order", 7]) {
      const config = bad({ rules: value });
      expect(config.warnings[0]).toContain('"rules" must be a mapping');
      // Falling back to the preset rather than inventing rule names.
      expect(config.rules.get("top-level-order")?.severity).toBe("warn");
    }
  });
});

describe("rule options", () => {
  it("accepts a declared option", () => {
    const config = resolveConfig({
      rules: { "service-key-order": ["warn", { order: ["ports", "image"] }] },
    });
    expect(config.warnings).toEqual([]);
    expect(config.rules.get("service-key-order")?.options.order).toEqual([
      "ports",
      "image",
    ]);
    // With ports first, the fixture is now in order.
    expect(ruleIds(config)).not.toContain("service-key-order");
  });

  it("reports an unknown option name", () => {
    const config = resolveConfig({
      rules: { "service-key-order": ["warn", { orders: ["ports"] }] },
    });
    expect(config.warnings[0]).toBe(
      'Rule "service-key-order": unknown option "orders" — ignored. Known options: order.',
    );
    expect(config.rules.get("service-key-order")?.options).toEqual({});
  });

  it("says so when a rule takes no options at all", () => {
    const config = resolveConfig({
      rules: { "no-privileged": ["warn", { level: 3 }] },
    });
    expect(config.warnings[0]).toContain("This rule takes no options.");
  });

  it("drops an option of the wrong type instead of guessing", () => {
    for (const value of ["image", 1, [1, 2], { a: 1 }, ["ok", 2]]) {
      const config = resolveConfig({
        rules: { "service-key-order": ["warn", { order: value }] },
      } as RawConfig);
      expect(config.warnings[0]).toBe(
        'Rule "service-key-order": option "order" must be an array of strings — ignored.',
      );
      expect(config.rules.get("service-key-order")?.options).toEqual({});
      // The rule keeps working on its default order.
      expect(ruleIds(config)).toContain("service-key-order");
    }
  });

  it("keeps a string option from being read as a list of characters", () => {
    const config = resolveConfig({
      rules: { "image-require-tag": ["warn", { forbiddenTags: "1.27" }] },
    } as RawConfig);
    expect(config.rules.get("image-require-tag")?.options).toEqual({});
    expect(ruleIds(config)).not.toContain("image-require-tag");
  });

  it("treats an empty order as no opinion", () => {
    const config = resolveConfig({
      rules: { "service-key-order": ["warn", { order: [] }] },
    });
    expect(config.warnings).toEqual([]);
    expect(ruleIds(config)).not.toContain("service-key-order");
  });

  it("tolerates duplicates in an order list", () => {
    const config = resolveConfig({
      rules: {
        "service-key-order": [
          "warn",
          { order: ["image", "image", "healthcheck", "ports"] },
        ],
      },
    });
    expect(config.warnings).toEqual([]);
    expect(ruleIds(config)).toContain("service-key-order");
  });

  it("declares options only for the rules that read them", () => {
    const declared = allRules
      .filter((rule) => rule.meta.options !== undefined)
      .map((rule) => [rule.meta.name, Object.keys(rule.meta.options ?? {})]);
    expect(declared).toEqual([
      ["top-level-order", ["order"]],
      ["service-key-order", ["order"]],
      ["image-require-tag", ["forbiddenTags"]],
      ["require-healthcheck", ["exclude"]],
    ]);
  });

  it("uses the built-in order when none is configured", () => {
    expect(DEFAULT_SERVICE_KEY_ORDER[0]).toBe("extends");
    expect(resolveConfig({}).rules.get("service-key-order")?.options).toEqual(
      {},
    );
  });
});

describe("preset and rules together", () => {
  it("lets a rule override win over the preset", () => {
    const config = resolveConfig(
      { rules: { "service-key-order": "off" } },
      "strict",
    );
    expect(config.rules.get("service-key-order")?.severity).toBe("off");
    expect(config.rules.get("top-level-order")?.severity).toBe("error");
  });

  it("lets the CLI preset win over the file preset", () => {
    const config = resolveConfig({ preset: "recommended" }, "strict");
    expect(config.rules.get("service-key-order")?.severity).toBe("error");
  });
});
