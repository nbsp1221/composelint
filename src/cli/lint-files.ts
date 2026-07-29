import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lintAndFix, lintSource } from "../core/linter.js";
import type { LintResult, ResolvedConfig, Rule } from "../core/types.js";
import { describeError } from "./exit.js";
import type { SourceFile } from "./includes.js";

export interface LintFilesOptions {
  sources: readonly SourceFile[];
  rules: Rule[];
  config: ResolvedConfig;
  /** Files that carry only part of a project, by configuration. */
  isPartial: (filePath: string) => boolean;
  /** Absolute paths reached through a top-level `include:`. */
  includedPaths: ReadonlySet<string>;
  /** Whether to write fixes back to disk. */
  fix: boolean;
}

export interface LintFilesResult {
  /** One result per file, before any `--quiet` filtering. */
  results: LintResult[];
  fixedCount: number;
  /** Files that could not be written, described for the user. */
  writeFailures: string[];
}

/**
 * Lints every file and, when asked, writes the fixes back.
 *
 * A file that cannot be written does not stop the run: aborting would leave the
 * fixes half applied and force the user through several more runs.
 */
export async function lintFiles(
  options: LintFilesOptions,
): Promise<LintFilesResult> {
  const results: LintResult[] = [];
  const writeFailures: string[] = [];
  let fixedCount = 0;

  for (const { filePath, source } of options.sources) {
    const lintOptions = {
      partial:
        options.isPartial(filePath) ||
        options.includedPaths.has(resolve(filePath)),
    };

    if (!options.fix) {
      results.push(
        lintSource(source, filePath, options.rules, options.config, lintOptions)
          .result,
      );
      continue;
    }

    const outcome = lintAndFix(
      source,
      filePath,
      options.rules,
      options.config,
      lintOptions,
    );
    results.push(outcome.result);

    if (!outcome.changed) continue;

    try {
      await writeFile(filePath, outcome.source, "utf-8");
      fixedCount++;
    } catch (error) {
      writeFailures.push(`cannot write "${filePath}": ${describeError(error)}`);
    }
  }

  return { results, fixedCount, writeFailures };
}
