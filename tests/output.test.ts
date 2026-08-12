import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/loader.js";
import { lintSource } from "../src/core/linter.js";
import { formatGithub } from "../src/formatters/github.js";
import { formatJson } from "../src/formatters/json.js";
import { formatSarif } from "../src/formatters/sarif.js";
import { formatStylish } from "../src/formatters/stylish.js";
import { allRules } from "../src/rules/index.js";
import { VERSION } from "../src/version.js";

const config = resolveConfig({});

const mockResult: LintResult = {
  filePath: "compose.yaml",
  fixed: false,
  diagnostics: [
    {
      ruleId: "no-version-field",
      severity: "error",
      message: "obsolete version field",
      range: { start: { line: 1, column: 1 }, end: { line: 1, column: 8 } },
      fix: {
        description: "remove the version field",
        edits: [{ start: 0, end: 15, text: "" }],
      },
    },
    {
      ruleId: "no-privileged",
      severity: "warn",
      message: "privileged mode",
      range: { start: { line: 5, column: 3 }, end: { line: 5, column: 20 } },
    },
  ],
};

function lint(source: string) {
  return lintSource(source, "compose.yaml", allRules, config).result;
}

const BROKEN = "name: q\nservices:\n  web:\n  image: [unclosed\n";

const PROBLEMS = [
  'version: "3.8"',
  "services:",
  "  web:",
  "    image: nginx",
  "    ports:",
  '      - "3000:3000"',
  "",
].join("\n");

describe("version reporting", () => {
  const packageVersion = (
    JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { version: string }
  ).version;

  it("comes from one place", () => {
    expect(VERSION).toBe(packageVersion);
  });

  it("is carried by the machine-readable formats", () => {
    const json = JSON.parse(formatJson([lint(PROBLEMS)])) as {
      version: string;
    };
    expect(json.version).toBe(packageVersion);

    const sarif = JSON.parse(formatSarif([lint(PROBLEMS)], allRules)) as {
      runs: Array<{ tool: { driver: { version: string } } }>;
    };
    expect(sarif.runs[0].tool.driver.version).toBe(packageVersion);
  });
});

describe("diagnostics stay on one line", () => {
  it("reduces a YAML error to a single line and keeps its position", () => {
    const diagnostics = lint(BROKEN).diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].ruleId).toBe("parse-error");
    expect(diagnostics[0].message).not.toContain("\n");
    expect(diagnostics[0].message).toBe(
      "YAML parse error: Flow sequence in block collection must be sufficiently indented and end with a ]",
    );
    // The parser knows where the problem is; the diagnostic uses it.
    expect(diagnostics[0].range.start).toEqual({ line: 5, column: 1 });
  });

  it("keeps every rule message on one line", () => {
    for (const diagnostic of lint(PROBLEMS).diagnostics) {
      expect(diagnostic.message).not.toContain("\n");
    }
  });

  it("prints one line per diagnostic in the stylish format", () => {
    const output = formatStylish([lint(BROKEN)]);
    const lines = output.split("\n").filter((line) => line.trim() !== "");
    // file header, the diagnostic, the summary
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("parse-error");
  });
});

describe("message shape", () => {
  it("prefixes every service-scoped message the same way", () => {
    const source = [
      "name: qa",
      "services:",
      "  web:",
      "    privileged: true",
      "    image: nginx",
      "    network_mode: host",
      "    cap_add:",
      "      - ALL",
      "    ports:",
      '      - "3000:3000"',
      "    build: .",
      "    typo_key: 1",
      "",
    ].join("\n");

    const serviceScoped = lintSource(
      source,
      "compose.yaml",
      allRules,
      config,
    ).result.diagnostics.filter((d) => d.message.startsWith("Service "));

    expect(serviceScoped.length).toBeGreaterThan(6);
    for (const diagnostic of serviceScoped) {
      expect(diagnostic.message).toMatch(/^Service "[^"]+": \S/);
      expect(diagnostic.message.endsWith(".")).toBe(false);
    }
  });
});

describe("GitHub annotations", () => {
  it("escapes the characters workflow commands treat specially", () => {
    const output = formatGithub([
      {
        filePath: "compose.yaml",
        fixed: false,
        diagnostics: [
          {
            ruleId: "TEST",
            severity: "error",
            message: "100% broken\r\nsecond line",
            range: {
              start: { line: 2, column: 3 },
              end: { line: 2, column: 4 },
            },
          },
        ],
      },
    ]);

    expect(output).toBe(
      "::error file=compose.yaml,line=2,col=3,title=TEST::100%25 broken%0D%0Asecond line",
    );
    expect(output.split("\n")).toHaveLength(1);
  });

  it("maps severities to annotation levels", () => {
    const output = formatGithub([lint(PROBLEMS)]);
    expect(output).toContain("::error file=compose.yaml");
    expect(output).toContain("::warning file=compose.yaml");
    for (const line of output.split("\n")) {
      expect(line).toMatch(
        /^::(error|warning) file=[^,]+,line=\d+,col=\d+,title=[\w-]+::/,
      );
    }
  });
});

describe("stylish formatter", () => {
  it("includes file path and diagnostics", () => {
    const output = formatStylish([mockResult]);
    expect(output).toContain("compose.yaml");
    expect(output).toContain("no-version-field");
    expect(output).toContain("no-privileged");
    expect(output).toContain("1 error");
    expect(output).toContain("1 warning");
    expect(output).toContain("fixable");
  });

  it("returns empty for clean results", () => {
    const clean: LintResult = {
      filePath: "ok.yaml",
      diagnostics: [],
      fixed: false,
    };
    expect(formatStylish([clean]).trim()).toBe("");
  });
});

describe("JSON output", () => {
  it("reports positions, fixability and a summary", () => {
    const parsed = JSON.parse(formatJson([lint(PROBLEMS)])) as {
      files: Array<{
        path: string;
        diagnostics: Array<{
          ruleId: string;
          severity: string;
          line: number;
          column: number;
          endLine: number;
          endColumn: number;
          fixable: boolean;
        }>;
      }>;
      summary: { errors: number; warnings: number; fixable: number };
    };

    const diagnostics = parsed.files[0].diagnostics;
    expect(parsed.files[0].path).toBe("compose.yaml");
    expect(diagnostics.length).toBeGreaterThan(0);

    for (const diagnostic of diagnostics) {
      expect(diagnostic.line).toBeGreaterThan(0);
      expect(diagnostic.column).toBeGreaterThan(0);
      expect(diagnostic.endLine).toBeGreaterThanOrEqual(diagnostic.line);
    }

    expect(parsed.summary.errors).toBe(
      diagnostics.filter((d) => d.severity === "error").length,
    );
    expect(parsed.summary.warnings).toBe(
      diagnostics.filter((d) => d.severity === "warn").length,
    );
    expect(parsed.summary.fixable).toBe(
      diagnostics.filter((d) => d.fixable).length,
    );
  });

  it("stays valid JSON when nothing was found", () => {
    const parsed = JSON.parse(
      formatJson([{ filePath: "compose.yaml", fixed: false, diagnostics: [] }]),
    ) as { summary: { errors: number } };
    expect(parsed.summary.errors).toBe(0);
  });
});

describe("json formatter", () => {
  it("produces valid JSON with summary", () => {
    const parsed = JSON.parse(formatJson([mockResult]));
    expect(parsed.version).toBe("0.2.0");
    expect(parsed.files).toHaveLength(1);
    expect(parsed.summary.errors).toBe(1);
    expect(parsed.summary.warnings).toBe(1);
    expect(parsed.summary.fixable).toBe(1);
  });
});

describe("SARIF output", () => {
  const sarif = JSON.parse(
    formatSarif([lint(PROBLEMS), lint(BROKEN)], allRules),
  ) as {
    $schema: string;
    version: string;
    runs: Array<{
      tool: { driver: { rules: Array<{ id: string }> } };
      results: Array<{
        ruleId: string;
        level: string;
        locations: Array<{
          physicalLocation: {
            artifactLocation: { uri: string };
            region: {
              startLine: number;
              startColumn: number;
              endLine: number;
              endColumn: number;
            };
          };
        }>;
      }>;
    }>;
  };

  it("declares the schema and version", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.$schema).toContain("sarif-schema-2.1.0.json");
  });

  it("declares every rule it reports, including the meta diagnostics", () => {
    const declared = new Set(
      sarif.runs[0].tool.driver.rules.map((rule) => rule.id),
    );
    expect(declared.has("parse-error")).toBe(true);
    expect(declared.has("suppression")).toBe(true);
    for (const result of sarif.runs[0].results) {
      expect(declared.has(result.ruleId)).toBe(true);
    }
  });

  it("gives every result a location with a 1-based region", () => {
    for (const result of sarif.runs[0].results) {
      const location = result.locations[0].physicalLocation;
      expect(location.artifactLocation.uri).toBe("compose.yaml");
      expect(location.region.startLine).toBeGreaterThan(0);
      expect(location.region.startColumn).toBeGreaterThan(0);
      expect(["error", "warning"]).toContain(result.level);
    }
  });
});

describe("github formatter", () => {
  it("produces workflow commands", () => {
    const output = formatGithub([mockResult]);
    expect(output).toContain(
      "::error file=compose.yaml,line=1,col=1,title=no-version-field::",
    );
    expect(output).toContain(
      "::warning file=compose.yaml,line=5,col=3,title=no-privileged::",
    );
  });
});
