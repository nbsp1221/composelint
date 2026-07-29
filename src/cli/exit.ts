import type { LintResult } from "../core/types.js";

/** Exit codes are part of the CLI contract; see README. */
export const EXIT_OK = 0;
export const EXIT_PROBLEMS = 1;
export const EXIT_USAGE = 2;

/** `--max-warnings` value meaning "no limit". */
export const NO_WARNING_LIMIT = -1;

export interface ParsedLimit {
  value: number;
  error?: string;
}

/**
 * Parses `--max-warnings`. Any integer >= 0 is a limit; -1 disables the check.
 */
export function parseMaxWarnings(raw: string | undefined): ParsedLimit {
  if (raw === undefined || raw === "") return { value: NO_WARNING_LIMIT };

  const value = Number(raw);
  if (!Number.isInteger(value) || value < NO_WARNING_LIMIT) {
    return {
      value: NO_WARNING_LIMIT,
      error: `Invalid --max-warnings value "${raw}": expected an integer >= 0 (or -1 to disable).`,
    };
  }

  return { value };
}

export interface DiagnosticCounts {
  errors: number;
  warnings: number;
}

/**
 * Counts diagnostics across files. This runs on the results *before* `--quiet`
 * filtering, so hiding warnings from the output does not change the limit.
 */
export function countDiagnostics(results: LintResult[]): DiagnosticCounts {
  let errors = 0;
  let warnings = 0;

  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === "error") errors++;
      else if (diagnostic.severity === "warn") warnings++;
    }
  }

  return { errors, warnings };
}

export interface ExitDecision {
  code: number;
  /** Message to print on stderr when the warning limit is exceeded. */
  message?: string;
}

/**
 * A one-line description of a thrown value. Stack traces are dropped: a broken
 * config file or an unwritable file is the user's environment, not a crash they
 * should have to read a trace for.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    // Node's fs errors read best without the "Error: " prefix and the syscall
    // noise that follows the message.
    return error.message.split("\n")[0];
  }
  return String(error);
}

/**
 * Errors always fail. Warnings only fail when they exceed `--max-warnings`.
 */
export function resolveExitCode(
  counts: DiagnosticCounts,
  maxWarnings: number,
): ExitDecision {
  if (counts.errors > 0) return { code: EXIT_PROBLEMS };

  if (maxWarnings !== NO_WARNING_LIMIT && counts.warnings > maxWarnings) {
    const subject =
      counts.warnings === 1
        ? "1 warning exceeds"
        : `${counts.warnings} warnings exceed`;
    return {
      code: EXIT_PROBLEMS,
      message: `${subject} the --max-warnings limit of ${maxWarnings}.`,
    };
  }

  return { code: EXIT_OK };
}
