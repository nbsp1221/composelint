import type { LintResult, Rule } from "../core/types.js";
import { formatGithub } from "./github.js";
import { formatJson } from "./json.js";
import { formatSarif } from "./sarif.js";
import { formatStylish } from "./stylish.js";

export const FORMATTER_NAMES = ["stylish", "json", "github", "sarif"] as const;

export type FormatterName = (typeof FORMATTER_NAMES)[number];

export function isFormatterName(value: string): value is FormatterName {
  return (FORMATTER_NAMES as readonly string[]).includes(value);
}

export function format(
  name: FormatterName,
  results: LintResult[],
  rules: Rule[],
): string {
  switch (name) {
    case "stylish":
      return formatStylish(results);
    case "json":
      return formatJson(results);
    case "github":
      return formatGithub(results);
    case "sarif":
      return formatSarif(results, rules);
  }
}
