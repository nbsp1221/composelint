import type { LintResult } from "../core/types.js";
import { VERSION } from "../version.js";

export function formatJson(results: LintResult[]): string {
  const output = {
    version: VERSION,
    files: results.map((r) => ({
      path: r.filePath,
      diagnostics: r.diagnostics.map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        message: d.message,
        line: d.range.start.line,
        column: d.range.start.column,
        endLine: d.range.end.line,
        endColumn: d.range.end.column,
        fixable: !!d.fix,
      })),
    })),
    summary: {
      errors: results.reduce(
        (n, r) =>
          n + r.diagnostics.filter((d) => d.severity === "error").length,
        0,
      ),
      warnings: results.reduce(
        (n, r) => n + r.diagnostics.filter((d) => d.severity === "warn").length,
        0,
      ),
      fixable: results.reduce(
        (n, r) => n + r.diagnostics.filter((d) => d.fix).length,
        0,
      ),
    },
  };

  return JSON.stringify(output, null, 2);
}
