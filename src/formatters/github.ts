import type { LintResult } from "../core/types.js";

/**
 * GitHub Actions workflow command annotations.
 * @see https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
 */
export function formatGithub(results: LintResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    for (const d of result.diagnostics) {
      const level = d.severity === "error" ? "error" : "warning";
      const file = result.filePath;
      const line = d.range.start.line;
      const col = d.range.start.column;
      const title = d.ruleId;
      const message = d.message
        .replace(/%/g, "%25")
        .replace(/\r/g, "%0D")
        .replace(/\n/g, "%0A");

      lines.push(
        `::${level} file=${file},line=${line},col=${col},title=${title}::${message}`,
      );
    }
  }

  return lines.join("\n");
}
