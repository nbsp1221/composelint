import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presets } from "../src/config/presets.js";
import { ruleDocsUrl } from "../src/rules/docs.js";
import { allRules } from "../src/rules/index.js";

/**
 * Documentation is checked the same way the rest of the project checks its
 * contracts: the code is the source of truth, and a test fails when the docs
 * drift away from it. This is what `eslint-doc-generator --check` does for
 * ESLint plugins; with twelve rules a check is enough and a generator is not
 * needed yet.
 */

const REQUIRED_SECTIONS = [
  "## What it does",
  "## Why it matters",
  "## Incorrect",
  "## Correct",
];

function docPath(ruleName: string): URL {
  return new URL(`../docs/rules/${ruleName}.md`, import.meta.url);
}

function readDoc(ruleName: string): string {
  return readFileSync(docPath(ruleName), "utf-8");
}

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");

/** The rules table rows in the README, keyed by rule name. */
const readmeRows = new Map(
  readme
    .split("\n")
    .filter((line) => /^\| \[[a-z-]+\]\(docs\/rules\//.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      // | rule | category | recommended | strict | fixable | options |
      const name = /\[([a-z-]+)\]/.exec(cells[1])?.[1] ?? "";
      return [
        name,
        {
          rule: cells[1],
          category: cells[2],
          recommended: cells[3],
          strict: cells[4],
          fixable: cells[5],
          options: cells[6],
        },
      ] as const;
    }),
);

const SEVERITY_EMOJI: Record<string, string> = {
  error: "💼",
  warn: "⚠️",
  off: "🚫",
};

describe("rule documentation", () => {
  it.each(allRules.map((rule) => [rule.meta.name, rule] as const))(
    "%s has a documentation file",
    (name) => {
      expect(existsSync(docPath(name))).toBe(true);
    },
  );

  it.each(allRules.map((rule) => [rule.meta.name] as const))(
    "%s starts with its name and has every required section",
    (name) => {
      const doc = readDoc(name);
      expect(doc.startsWith(`# ${name}`)).toBe(true);
      for (const section of REQUIRED_SECTIONS) {
        expect(doc, `missing "${section}"`).toContain(section);
      }
    },
  );

  it.each(
    allRules
      .filter((rule) => rule.meta.options !== undefined)
      .map((rule) => [rule.meta.name, rule] as const),
  )("%s documents each option it accepts", (name, rule) => {
    const doc = readDoc(name);
    expect(doc).toContain("## Options");
    for (const option of Object.keys(rule.meta.options ?? {})) {
      expect(doc, `option "${option}" is not documented`).toContain(
        `### \`${option}\``,
      );
    }
  });

  it.each(
    allRules
      .filter((rule) => rule.meta.options === undefined)
      .map((rule) => [rule.meta.name] as const),
  )("%s does not claim to have options", (name) => {
    expect(readDoc(name)).not.toContain("## Options");
  });

  it.each(allRules.map((rule) => [rule.meta.name, rule] as const))(
    "%s states the severity it has in each preset",
    (name, rule) => {
      const doc = readDoc(name);
      for (const [preset, severities] of Object.entries(presets)) {
        expect(doc, `missing the ${preset} severity`).toMatch(
          new RegExp(
            `\\|\\s*\`${preset}\`\\s*\\|\\s*\\*?\\*?${severities[rule.meta.name]}`,
          ),
        );
      }
    },
  );

  it("marks fixable rules as fixable", () => {
    for (const rule of allRules) {
      const doc = readDoc(rule.meta.name);
      expect(doc.includes("🔧 Fixable with `--fix`."), rule.meta.name).toBe(
        rule.meta.fixable,
      );
    }
  });

  it("points the documentation URL at a file that exists", () => {
    for (const rule of allRules) {
      const url = ruleDocsUrl(rule.meta.name);
      expect(url.endsWith(`/docs/rules/${rule.meta.name}.md`)).toBe(true);
      expect(existsSync(docPath(rule.meta.name))).toBe(true);
    }
  });
});

describe("README rules table", () => {
  it("lists every rule exactly once", () => {
    expect(readmeRows.size).toBe(allRules.length);
    for (const rule of allRules) {
      expect(readmeRows.has(rule.meta.name), rule.meta.name).toBe(true);
    }
  });

  it("matches the rule metadata", () => {
    for (const rule of allRules) {
      const row = readmeRows.get(rule.meta.name);
      expect(row, rule.meta.name).toBeDefined();
      if (!row) continue;

      expect(row.rule).toBe(
        `[${rule.meta.name}](docs/rules/${rule.meta.name}.md)`,
      );
      expect(row.category).toBe(rule.meta.category);
      expect(row.fixable).toBe(rule.meta.fixable ? "🔧" : "");
      expect(row.options).toBe(rule.meta.options ? "⚙️" : "");
    }
  });

  it("matches the severity of each preset", () => {
    for (const rule of allRules) {
      const row = readmeRows.get(rule.meta.name);
      if (!row) continue;
      expect(row.recommended, `${rule.meta.name} recommended`).toBe(
        SEVERITY_EMOJI[presets.recommended[rule.meta.name]],
      );
      expect(row.strict, `${rule.meta.name} strict`).toBe(
        SEVERITY_EMOJI[presets.strict[rule.meta.name]],
      );
    }
  });

  it("explains the legend it uses", () => {
    for (const symbol of ["💼", "⚠️", "🔧", "⚙️"]) {
      expect(readme).toContain(symbol);
    }
  });
});

describe("project documentation", () => {
  it("ships a licence that matches package.json", () => {
    const licence = readFileSync(
      new URL("../LICENSE", import.meta.url),
      "utf-8",
    );
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { license: string };
    expect(pkg.license).toBe("MIT");
    expect(licence).toContain("MIT License");
  });

  it("documents every CLI option the command accepts", () => {
    const cli = readFileSync(
      new URL("../src/cli/index.ts", import.meta.url),
      "utf-8",
    );
    const options = [...cli.matchAll(/^\s{4}"?([a-z-]+)"?: \{$/gm)].map(
      (match) => match[1],
    );
    expect(options.length).toBeGreaterThan(4);
    for (const option of options) {
      expect(readme, `--${option} is not documented`).toContain(`--${option}`);
    }
  });

  it("links the guides it references", () => {
    for (const guide of ["docs/configuration.md", "docs/suppressions.md"]) {
      expect(readme).toContain(guide);
      expect(existsSync(new URL(`../${guide}`, import.meta.url))).toBe(true);
    }
  });

  it("states the limits of the security rules", () => {
    expect(readme).toContain("not** a complete container security review");
  });
});
