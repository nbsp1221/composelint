import { PARSE_RULE_ID } from "../core/linter.js";
import { SUPPRESSION_RULE_ID } from "../core/suppressions.js";
import type { LintResult, Rule } from "../core/types.js";
import { ruleDocsUrl } from "../rules/docs.js";
import { VERSION } from "../version.js";

/**
 * Diagnostics that are not produced by a rule still need a descriptor so the
 * SARIF run is self-contained.
 */
const META_RULES = [
  {
    id: PARSE_RULE_ID,
    shortDescription: { text: "The file is not valid YAML" },
    defaultConfiguration: { level: "error" },
    properties: { category: "syntax", fixable: false },
  },
  {
    id: SUPPRESSION_RULE_ID,
    shortDescription: {
      text: "A suppression comment is unused or references an unknown rule",
    },
    defaultConfiguration: { level: "warning" },
    properties: { category: "suppression", fixable: false },
  },
];

/**
 * SARIF 2.1.0 output for GitHub Code Scanning.
 */
export function formatSarif(results: LintResult[], rules: Rule[]): string {
  const sarif = {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0" as const,
    runs: [
      {
        tool: {
          driver: {
            name: "composelint",
            version: VERSION,
            informationUri: "https://github.com/nbsp1221/composelint",
            rules: [
              ...rules.map((r) => ({
                id: r.meta.name,
                shortDescription: { text: r.meta.description },
                helpUri: ruleDocsUrl(r.meta.name),
                defaultConfiguration: {
                  level:
                    r.meta.defaultSeverity === "error" ? "error" : "warning",
                },
                properties: {
                  category: r.meta.category,
                  fixable: r.meta.fixable,
                },
              })),
              ...META_RULES,
            ],
          },
        },
        results: results.flatMap((result) =>
          result.diagnostics.map((d) => ({
            ruleId: d.ruleId,
            level: d.severity === "error" ? "error" : "warning",
            message: { text: d.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: result.filePath },
                  region: {
                    startLine: d.range.start.line,
                    startColumn: d.range.start.column,
                    endLine: d.range.end.line,
                    endColumn: d.range.end.column,
                  },
                },
              },
            ],
          })),
        ),
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
