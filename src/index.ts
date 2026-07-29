/**
 * The package entry point.
 *
 * `lintSource` and `lintAndFix` need a rule list and a resolved configuration,
 * so both are exported alongside them: a caller has to be able to produce every
 * argument from this module alone.
 */

export { resolveConfig } from "./config/loader.js";
export { ComposeDocument } from "./core/document.js";
export type {
  FixOutcome,
  LintOptions,
  LintOutput,
} from "./core/linter.js";
export { lintAndFix, lintSource, PARSE_RULE_ID } from "./core/linter.js";
export { SUPPRESSION_RULE_ID } from "./core/suppressions.js";
export type {
  Diagnostic,
  Fix,
  LintResult,
  ReportDescriptor,
  ResolvedConfig,
  Rule,
  RuleCategory,
  RuleConfig,
  RuleContext,
  RuleMeta,
  Severity,
  SourcePosition,
  SourceRange,
  TextEdit,
} from "./core/types.js";
export { allRules } from "./rules/index.js";
