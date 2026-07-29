import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");

/**
 * The Node API is only usable if a caller can build every argument from the
 * package entry point. It could not: `lintSource` was exported while the rule
 * list and the configuration it needs were not, so the snippet in the README
 * threw. These tests pin the surface to what the README promises.
 */
describe("public API", () => {
  it("exports what the README imports", () => {
    const imports = [
      ...readme.matchAll(/import \{([^}]+)\} from "composelint"/g),
    ]
      .flatMap((match) => match[1].split(","))
      .map((name) => name.trim())
      .filter((name) => name !== "");

    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) {
      expect(Object.keys(api)).toContain(name);
    }
  });

  it("can lint a file using only the entry point", () => {
    const { lintSource, resolveConfig, allRules } = api;
    const source = "services:\n  web:\n    image: nginx\n";
    const { result } = lintSource(
      source,
      "compose.yaml",
      allRules,
      resolveConfig({}),
    );
    expect(result.diagnostics.map((d) => d.ruleId)).toContain(
      "image-require-tag",
    );
  });

  it("can fix a file using only the entry point", () => {
    const { lintAndFix, resolveConfig, allRules } = api;
    const source =
      'version: "3.8"\nname: qa\nservices:\n  web:\n    image: nginx:1.27\n';
    const { source: fixed } = lintAndFix(
      source,
      "compose.yaml",
      allRules,
      resolveConfig({}),
    );
    expect(fixed).not.toContain("version:");
  });

  it("keeps the surface deliberate", () => {
    // A new export is a support commitment, so adding one has to be a choice.
    expect(Object.keys(api).sort()).toEqual([
      "ComposeDocument",
      "PARSE_RULE_ID",
      "SUPPRESSION_RULE_ID",
      "allRules",
      "lintAndFix",
      "lintSource",
      "resolveConfig",
    ]);
  });
});
