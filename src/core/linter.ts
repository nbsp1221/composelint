import { ComposeDocument } from "./document.js";
import { createSuppressions, SUPPRESSION_RULE_ID } from "./suppressions.js";
import { applyEdits } from "./text-edit.js";
import type {
  Diagnostic,
  LintResult,
  ResolvedConfig,
  Rule,
  RuleContext,
} from "./types.js";

export interface LintOutput {
  result: LintResult;
  document: ComposeDocument;
}

/** Diagnostic id used for YAML parse failures, which cannot be suppressed. */
export const PARSE_RULE_ID = "parse-error";

/** Upper bound on fix passes, matching ESLint's behaviour. */
const MAX_FIX_PASSES = 10;

export interface LintOptions {
  /**
   * True when the file only carries part of a project (an override file or an
   * `include:` fragment). Rules marked `requiresFullProject` are skipped.
   */
  partial?: boolean;
}

export function lintSource(
  source: string,
  filePath: string,
  rules: Rule[],
  config: ResolvedConfig,
  options: LintOptions = {},
): LintOutput {
  const document = new ComposeDocument(source, filePath);
  const diagnostics: Diagnostic[] = [];

  if (document.parseProblems.length > 0) {
    for (const problem of document.parseProblems) {
      diagnostics.push({
        ruleId: PARSE_RULE_ID,
        severity: "error",
        message: `YAML parse error: ${problem.message}`,
        range: { start: problem.position, end: problem.position },
      });
    }
    return {
      result: { filePath, diagnostics, fixed: false },
      document,
    };
  }

  // Suppression comments are resolved up front so a suppressed diagnostic never
  // enters the result — which also means its fix is never applied.
  const suppressions = createSuppressions(source, rules);

  for (const rule of rules) {
    const ruleConfig = config.rules.get(rule.meta.name);
    if (!ruleConfig || ruleConfig.severity === "off") continue;
    // A partial file cannot answer project-wide questions; the rest of the
    // project lives in another file.
    if (options.partial && rule.meta.requiresFullProject) continue;

    const context: RuleContext = {
      document,
      options: ruleConfig.options,
      report(descriptor) {
        const range = document.getNodeRange(descriptor.node);
        if (suppressions.isSuppressed(rule.meta.name, range.start.line)) return;

        const edits = descriptor.fix?.();

        diagnostics.push({
          ruleId: rule.meta.name,
          severity: ruleConfig.severity,
          message: descriptor.message,
          range,
          fix:
            edits && edits.length > 0
              ? { description: `fix ${rule.meta.name}`, edits }
              : undefined,
        });
      },
    };

    rule.create(context);
  }

  for (const problem of suppressions.problems()) {
    diagnostics.push({
      ruleId: SUPPRESSION_RULE_ID,
      severity: "warn",
      message: problem.message,
      range: { start: problem.position, end: problem.position },
    });
  }

  return {
    result: { filePath, diagnostics, fixed: false },
    document,
  };
}

export interface FixOutcome {
  /** The source after fixing; identical to the input when nothing changed. */
  source: string;
  changed: boolean;
  /** Number of fixes applied across all passes. */
  appliedCount: number;
  passes: number;
  /** Lint result for the final source. */
  result: LintResult;
  document: ComposeDocument;
}

/**
 * Lints `source`, applies every fix that can be applied, and repeats until no
 * more fixes apply.
 *
 * Fixes are text edits, so several fixes can target overlapping regions (for
 * example removing `version` while also reordering the top-level keys). Each
 * pass applies the non-overlapping subset and the rest are retried on the
 * rewritten source. A pass is discarded if it would make the file unparseable.
 */
export function lintAndFix(
  source: string,
  filePath: string,
  rules: Rule[],
  config: ResolvedConfig,
  options: LintOptions = {},
): FixOutcome {
  let current = source;
  let output = lintSource(current, filePath, rules, config, options);
  let appliedCount = 0;
  let passes = 0;

  while (passes < MAX_FIX_PASSES) {
    const edits = output.result.diagnostics.flatMap((d) => d.fix?.edits ?? []);
    if (edits.length === 0) break;

    const { output: next, applied } = applyEdits(current, edits);
    if (applied === 0 || next === current) break;

    const candidate = lintSource(next, filePath, rules, config, options);
    // Never hand back a file we just broke.
    if (candidate.document.parseErrors.length > 0) break;

    current = next;
    output = candidate;
    appliedCount += applied;
    passes++;
  }

  const changed = current !== source;

  return {
    source: current,
    changed,
    appliedCount,
    passes,
    result: changed ? { ...output.result, fixed: true } : output.result,
    document: output.document,
  };
}
