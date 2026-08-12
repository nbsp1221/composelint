import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repoRoot, "dist/cli/index.js");

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the built CLI in `cwd`, capturing output instead of throwing. */
async function cliRun(cwd: string, args: string[] = []): Promise<CliResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
      cwd,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

async function workspace(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "composelint-cli-"));
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf-8");
  }
  return dir;
}

const CLEAN = [
  "name: qa",
  "services:",
  "  web:",
  "    image: nginx:1.27",
  "    ports:",
  '      - "127.0.0.1:8080:80"',
  '    healthcheck: { test: ["CMD", "true"] }',
  "",
].join("\n");

const WITH_WARNINGS = [
  "name: qa",
  "services:",
  "  web:",
  "    image: nginx",
  "    ports:",
  '      - "3000:3000"',
  '    healthcheck: { test: ["CMD", "true"] }',
  "",
].join("\n");

const WITH_ERROR = ['version: "3.8"', ...CLEAN.split("\n")].join("\n");

beforeAll(async () => {
  // The tests exercise the shipped entry point, so it must reflect the sources.
  await run("pnpm", ["build"], { cwd: repoRoot });
}, 60_000);

describe("exit codes", () => {
  it("passes a clean project", async () => {
    const dir = await workspace({ "compose.yaml": CLEAN });
    const result = await cliRun(dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("fails on an error-level diagnostic", async () => {
    const dir = await workspace({ "compose.yaml": WITH_ERROR });
    const result = await cliRun(dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("no-version-field");
  });

  it("passes with warnings when no limit is set", async () => {
    const dir = await workspace({ "compose.yaml": WITH_WARNINGS });
    const result = await cliRun(dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no-unbound-ports");
  });

  it("fails when warnings exceed --max-warnings", async () => {
    const dir = await workspace({ "compose.yaml": WITH_WARNINGS });
    const result = await cliRun(dir, ["--max-warnings", "0"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("exceed the --max-warnings limit of 0");
  });

  it("counts warnings even when --quiet hides them", async () => {
    const dir = await workspace({ "compose.yaml": WITH_WARNINGS });
    const result = await cliRun(dir, ["--quiet", "--max-warnings", "0"]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("input validation", () => {
  it("rejects an unknown formatter", async () => {
    const dir = await workspace({ "compose.yaml": CLEAN });
    const result = await cliRun(dir, ["--format", "bogus"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown --format value "bogus"');
  });

  it("rejects a non-integer --max-warnings", async () => {
    const dir = await workspace({ "compose.yaml": CLEAN });
    const result = await cliRun(dir, ["--max-warnings", "abc"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Invalid --max-warnings");
  });

  it("reports a missing target", async () => {
    const dir = await workspace({ "compose.yaml": CLEAN });
    const result = await cliRun(dir, ["nope.yaml"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("File not found");
  });

  it("reports a broken configuration file without a stack trace", async () => {
    const dir = await workspace({
      "compose.yaml": CLEAN,
      ".composelintrc.json": '{ "rules": { oops }\n',
    });
    const result = await cliRun(dir);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cannot read configuration");
    expect(result.stderr).not.toContain("    at ");
  });
});

describe("output formats", () => {
  it("writes machine-readable JSON to stdout only", async () => {
    const dir = await workspace({ "compose.yaml": WITH_WARNINGS });
    const result = await cliRun(dir, [
      "--format",
      "json",
      "--max-warnings",
      "0",
    ]);
    const parsed = JSON.parse(result.stdout) as {
      files: Array<{ path: string; diagnostics: unknown[] }>;
    };
    expect(parsed.files[0].path).toBe("compose.yaml");
    expect(parsed.files[0].diagnostics.length).toBeGreaterThan(0);
    expect(result.stderr).toContain("--max-warnings");
  });

  it("emits SARIF whose results all have a rule descriptor", async () => {
    const dir = await workspace({ "compose.yaml": WITH_ERROR });
    const result = await cliRun(dir, ["--format", "sarif"]);
    const sarif = JSON.parse(result.stdout) as {
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
        results: Array<{ ruleId: string }>;
      }>;
    };
    const declared = new Set(
      sarif.runs[0].tool.driver.rules.map((rule) => rule.id),
    );
    for (const entry of sarif.runs[0].results) {
      expect(declared.has(entry.ruleId)).toBe(true);
    }
  });
});

describe("--fix", () => {
  it("rewrites the file, is idempotent, and keeps CRLF", async () => {
    const crlf = [
      "name: qa",
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:8080:80"',
      "    image: nginx:1.27  # pinned",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\r\n");

    const dir = await workspace({ "compose.yaml": crlf });
    const first = await cliRun(dir, ["--fix"]);
    expect(first.stdout).toContain("Fixed 1 file");

    const fixed = await readFile(join(dir, "compose.yaml"), "utf-8");
    expect(fixed.indexOf("image:")).toBeLessThan(fixed.indexOf("ports:"));
    expect(fixed).toContain("    image: nginx:1.27  # pinned\r\n");
    expect(fixed.includes("\n\n")).toBe(false);

    const second = await cliRun(dir, ["--fix"]);
    expect(second.stdout).not.toContain("Fixed");
    expect(await readFile(join(dir, "compose.yaml"), "utf-8")).toBe(fixed);
  });
  it("fixes the other files when one cannot be written", async () => {
    const outOfOrder = [
      "name: qa",
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:8080:80"',
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");

    const dir = await workspace({
      "compose.a.yaml": outOfOrder,
      "compose.b.yaml": outOfOrder,
      "compose.c.yaml": outOfOrder,
    });
    await chmod(join(dir, "compose.b.yaml"), 0o444);

    const result = await cliRun(dir, ["--fix"]);
    await chmod(join(dir, "compose.b.yaml"), 0o644);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('cannot write "compose.b.yaml"');
    expect(result.stdout).toContain("Fixed 2 files");

    const read = async (name: string) =>
      await readFile(join(dir, name), "utf-8");
    const [a, b, c] = await Promise.all([
      read("compose.a.yaml"),
      read("compose.b.yaml"),
      read("compose.c.yaml"),
    ]);

    expect(a.indexOf("image:")).toBeLessThan(a.indexOf("ports:"));
    expect(c.indexOf("image:")).toBeLessThan(c.indexOf("ports:"));
    expect(b).toBe(outOfOrder);
  });
});

describe("partial files", () => {
  it("does not ask an override file for a project name or healthchecks", async () => {
    const dir = await workspace({
      "compose.yaml": CLEAN,
      "compose.override.yaml": [
        "services:",
        "  web:",
        '      environment: { DEBUG: "1" }',
        "",
      ].join("\n"),
    });
    const result = await cliRun(dir);
    expect(result.stdout).not.toContain("require-name");
    expect(result.stdout).not.toContain("require-healthcheck");
    expect(result.code).toBe(0);
  });

  it("treats an included fragment as partial, even when linted alone", async () => {
    const dir = await workspace({
      "compose.yaml": [
        "name: qa",
        "include:",
        "  - ./fragments/db.yaml",
        "services:",
        "  web:",
        "    image: nginx:1.27",
        '    healthcheck: { test: ["CMD", "true"] }',
        "",
      ].join("\n"),
      "fragments/db.yaml": [
        "services:",
        "  db:",
        "    image: postgres:17",
        "",
      ].join("\n"),
    });

    const all = await cliRun(dir);
    expect(all.stdout).not.toContain("require-name");
    expect(all.stdout).not.toContain("require-healthcheck");

    const alone = await cliRun(dir, ["fragments/db.yaml"]);
    expect(alone.stdout).not.toContain("require-name");
    expect(alone.stdout).not.toContain("require-healthcheck");
    expect(alone.code).toBe(0);
  });
});

describe("configuration", () => {
  it("applies rule overrides from the project config", async () => {
    const dir = await workspace({
      "compose.yaml": WITH_WARNINGS,
      ".composelintrc.json": JSON.stringify({
        rules: { "no-unbound-ports": "error", "image-require-tag": "off" },
      }),
    });
    const result = await cliRun(dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("no-unbound-ports");
    expect(result.stdout).not.toContain("image-require-tag");
  });

  it("allows only the configured public service ports", async () => {
    const compose = [
      "name: qa",
      "services:",
      "  caddy:",
      "    image: caddy:2.10",
      "    ports:",
      '      - "80:80"',
      '      - "443:443"',
      '      - "443:443/udp"',
      '    healthcheck: { test: ["CMD", "true"] }',
      "  db:",
      "    image: postgres:17",
      "    ports:",
      '      - "5432:5432"',
      '    healthcheck: { test: ["CMD", "true"] }',
      "  telecom:",
      "    image: alpine:3.22",
      "    ports:",
      '      - "9899:9899/sctp"',
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    const dir = await workspace({
      "compose.yaml": compose,
      ".composelintrc.json": JSON.stringify({
        rules: {
          "no-unbound-ports": [
            "warn",
            {
              allow: [
                {
                  service: "caddy",
                  published: ["80/tcp", "443/tcp", "443/udp"],
                  reason: "Public ingress",
                },
                {
                  service: "telecom",
                  published: ["9899/sctp"],
                  reason: "Public SCTP endpoint",
                },
              ],
            },
          ],
        },
      }),
    });

    const result = await cliRun(dir, [
      "--format",
      "json",
      "--max-warnings",
      "0",
    ]);
    const output = JSON.parse(result.stdout) as {
      files: Array<{
        diagnostics: Array<{ ruleId: string; message: string }>;
      }>;
    };
    const portDiagnostics = output.files
      .flatMap((file) => file.diagnostics)
      .filter((diagnostic) => diagnostic.ruleId === "no-unbound-ports");

    expect(result.code).toBe(1);
    expect(portDiagnostics).toHaveLength(1);
    expect(portDiagnostics[0].message).toContain('Service "db"');
    expect(result.stderr).toContain("1 warning exceeds");
  });

  it("excludes files by glob", async () => {
    const dir = await workspace({
      "compose.yaml": CLEAN,
      "examples/compose.yaml": WITH_ERROR,
      ".composelintrc.json": JSON.stringify({ exclude: ["examples/**"] }),
    });
    const result = await cliRun(dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
  });

  // A pipe accepts 64 KB before the writer has to wait, so anything larger is
  // still buffered when the command finishes. Exiting through `process.exit()`
  // would drop that buffer and hand `jq` — or a `> file.sarif` redirect through
  // a shell pipeline — a truncated document.
  describe("output larger than the pipe buffer", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      files[`stack-${i}/compose.yaml`] = `services:
  web-${i}:
    image: nginx
    ports:
      - "${8000 + i}:80"
  api-${i}:
    image: node
    privileged: true
    ports:
      - "${9000 + i}:3000"
`;
    }

    it.each(["json", "sarif"] as const)(
      "writes complete %s to a pipe",
      async (format) => {
        const dir = await workspace(files);
        // `--max-warnings 0` also pins down that the exit code survives the
        // switch away from `process.exit()`.
        const result = await cliRun(dir, [
          "--format",
          format,
          "--max-warnings",
          "0",
        ]);

        expect(result.stdout.length).toBeGreaterThan(64 * 1024);
        const parsed = JSON.parse(result.stdout) as unknown;
        expect(parsed).toBeTypeOf("object");
        // The tail of the document has to survive, not just the first 64 KB.
        expect(result.stdout.trimEnd().endsWith("}")).toBe(true);
        expect(result.stdout).toContain("stack-59");
        expect(result.code).toBe(1);
      },
    );
  });
});
