import { resolveConfig } from "../src/config/loader.js";
import { lintSource } from "../src/core/linter.js";
import type {
  Diagnostic,
  LintResult,
  ResolvedConfig,
} from "../src/core/types.js";
import { allRules } from "../src/rules/index.js";

/**
 * Shared plumbing for the tests. Only the linting call is shared: every test
 * writes its own Compose fixture inline, so what is being checked stays visible
 * in the test itself.
 */

/** The default configuration: the `recommended` preset with no overrides. */
export const recommended: ResolvedConfig = resolveConfig({});

export function lint(
  source: string,
  config: ResolvedConfig = recommended,
): LintResult {
  return lintSource(source, "compose.yaml", allRules, config).result;
}

/** Rule ids reported for `source`, in the order the rules ran. */
export function ruleIds(
  source: string,
  config: ResolvedConfig = recommended,
): string[] {
  return lint(source, config).diagnostics.map((d) => d.ruleId);
}

/** Diagnostics of one rule, for tests that assert positions or fixability. */
export function diagnosticsFor(
  source: string,
  ruleId: string,
  config: ResolvedConfig = recommended,
): Diagnostic[] {
  return lint(source, config).diagnostics.filter((d) => d.ruleId === ruleId);
}

/** Messages of one rule, for tests that assert the wording. */
export function messagesFor(
  source: string,
  ruleId: string,
  config: ResolvedConfig = recommended,
): string[] {
  return diagnosticsFor(source, ruleId, config).map((d) => d.message);
}
