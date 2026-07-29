import pc from "picocolors";
import type { LintResult } from "../core/types.js";

export function formatStylish(results: LintResult[]): string {
  const lines: string[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalFixable = 0;

  for (const result of results) {
    if (result.diagnostics.length === 0) continue;

    lines.push(pc.underline(result.filePath));

    for (const d of result.diagnostics) {
      const pos = `${d.range.start.line}:${d.range.start.column}`;
      const severity =
        d.severity === "error" ? pc.red("error") : pc.yellow("warn");
      const ruleId = pc.dim(d.ruleId);
      const fixable = d.fix ? pc.dim(" [fixable]") : "";

      if (d.severity === "error") totalErrors++;
      else totalWarnings++;
      if (d.fix) totalFixable++;

      lines.push(
        `  ${pc.dim(pos.padEnd(7))} ${severity}  ${d.message}  ${ruleId}${fixable}`,
      );
    }

    lines.push("");
  }

  const total = totalErrors + totalWarnings;
  if (total > 0) {
    const parts: string[] = [];
    if (totalErrors > 0)
      parts.push(pc.red(`${totalErrors} error${totalErrors > 1 ? "s" : ""}`));
    if (totalWarnings > 0)
      parts.push(
        pc.yellow(`${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}`),
      );
    lines.push(
      `${pc.bold("✖")} ${total} problem${total > 1 ? "s" : ""} (${parts.join(", ")})`,
    );
    if (totalFixable > 0) {
      lines.push(pc.dim(`  ${totalFixable} fixable with --fix`));
    }
  }

  return lines.join("\n");
}
