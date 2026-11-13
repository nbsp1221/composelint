import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defineCommand, runMain } from "citty";
import pc from "picocolors";
import { DEFAULT_EXCLUDE } from "../config/defaults.js";
import { createPathMatcher, type PathMatcher } from "../config/glob.js";
import { loadConfig, type RawConfig, resolveConfig } from "../config/loader.js";
import type { PresetName } from "../config/presets.js";
import type { ResolvedConfig } from "../core/types.js";
import {
  FORMATTER_NAMES,
  format,
  isFormatterName,
} from "../formatters/index.js";
import { allRules } from "../rules/index.js";
import { VERSION } from "../version.js";
import { findComposeFiles, resolveTargets } from "./discover.js";
import { extractExcludes } from "./exclude-args.js";
import {
  countDiagnostics,
  describeError,
  EXIT_OK,
  EXIT_USAGE,
  parseMaxWarnings,
  resolveExitCode,
} from "./exit.js";
import { collectIncludedPaths, type SourceFile } from "./includes.js";
import { lintFiles } from "./lint-files.js";

/**
 * Reads every Compose file in the project so `include:` references can be
 * resolved even when only a few files are being linted. Already-read sources are
 * reused, and unreadable files are skipped.
 */
async function readIncludeIndex(
  baseDir: string,
  isExcluded: PathMatcher,
  known: readonly SourceFile[],
): Promise<SourceFile[]> {
  const byPath = new Map<string, SourceFile>();
  for (const file of known) {
    byPath.set(resolve(file.filePath), file);
  }

  for (const filePath of await findComposeFiles(baseDir, isExcluded)) {
    const absolute = resolve(filePath);
    if (byPath.has(absolute)) continue;
    try {
      byPath.set(absolute, {
        filePath,
        source: await readFile(filePath, "utf-8"),
      });
    } catch {
      // A file we cannot read cannot tell us about its includes.
    }
  }

  return [...byPath.values()];
}

// Every exit path sets `process.exitCode` instead of calling `process.exit()`.
// When stdout is a pipe rather than a file or a terminal, writes are
// asynchronous, and `process.exit()` tears the process down before the pending
// buffer is flushed: `composelint --format json | jq` would silently lose
// everything past the 64 KB pipe buffer. Letting Node exit on its own once the
// event loop drains keeps the output intact.

/** Reports an environment problem and marks the run as a usage failure. */
function fail(message: string): void {
  console.error(pc.red(`composelint: ${message}`));
  process.exitCode = EXIT_USAGE;
}

const main = defineCommand({
  meta: {
    name: "composelint",
    version: VERSION,
    description:
      "Linter and formatter for Docker Compose files, with key ordering, style, and security checks",
  },
  args: {
    fix: {
      type: "boolean",
      description: "Automatically fix problems where possible",
      default: false,
    },
    "fix-dry-run": {
      type: "boolean",
      description: "Preview automatic fixes without writing files",
      default: false,
    },
    exclude: {
      type: "string",
      description:
        "Exclude a glob relative to the working directory (repeatable)",
    },
    format: {
      type: "string",
      description: "Output format: stylish, json, github, sarif",
      default: "stylish",
    },
    config: {
      type: "string",
      description: "Path to configuration file",
    },
    preset: {
      type: "string",
      description: "Rule preset: recommended (default), strict",
    },
    quiet: {
      type: "boolean",
      description: "Report errors only, suppress warnings",
      default: false,
      alias: "q",
    },
    "max-warnings": {
      type: "string",
      description:
        "Fail when more than this many warnings are reported (-1 disables)",
      default: "-1",
    },
  },
  async run({ args, rawArgs }) {
    try {
      const targets = args._;
      const dryRun = args["fix-dry-run"];
      if (args.fix && dryRun) {
        return fail("--fix and --fix-dry-run cannot be used together.");
      }
      let cliExcludes: string[];
      try {
        cliExcludes = extractExcludes(rawArgs, [
          "--config",
          "--format",
          "--preset",
          "--max-warnings",
          "--maxWarnings",
        ]);
      } catch (error) {
        return fail(describeError(error));
      }

      const maxWarnings = parseMaxWarnings(
        args["max-warnings"] as string | undefined,
      );
      if (maxWarnings.error) {
        return fail(maxWarnings.error);
      }

      const formatterName = args.format as string;
      if (!isFormatterName(formatterName)) {
        return fail(
          `Unknown --format value "${formatterName}": expected one of ${FORMATTER_NAMES.join(", ")}.`,
        );
      }

      const configPath = args.config as string | undefined;
      let rawConfig: RawConfig;
      let filepath: string | undefined;
      try {
        const loaded = await loadConfig(configPath);
        rawConfig = loaded.config;
        filepath = loaded.filepath;
      } catch (error) {
        return fail(
          `cannot read configuration${configPath ? ` "${configPath}"` : ""}: ${describeError(error)}`,
        );
      }
      const config: ResolvedConfig = resolveConfig(
        rawConfig,
        args.preset as PresetName | undefined,
      );

      for (const warning of config.warnings) {
        console.error(pc.yellow(`composelint: ${warning}`));
      }

      // Exclude patterns resolve relative to the configuration file, so a config
      // committed to a repository behaves the same from any subdirectory.
      const cwd = process.cwd();
      const baseDir = filepath ? dirname(filepath) : cwd;
      const isExcluded = createPathMatcher(config.exclude, baseDir, {
        patterns: cliExcludes,
        baseDir: cwd,
      });
      const excludeReason =
        cliExcludes.length > 0 ? "exclude patterns" : "configuration";
      // Override files and declared fragments only carry part of a project.
      const isPartial = createPathMatcher(config.partials, baseDir);

      const { files, skipped, missing } = await resolveTargets(
        targets,
        isExcluded,
      );

      for (const target of missing) {
        console.error(pc.red(`File not found: ${target}`));
      }
      if (missing.length > 0) {
        process.exitCode = EXIT_USAGE;
        return;
      }

      for (const file of skipped) {
        console.error(
          pc.yellow(`composelint: "${file}" is excluded by ${excludeReason}.`),
        );
      }

      if (files.length === 0) {
        const hasUserExcludes =
          cliExcludes.length > 0 ||
          config.exclude.length > DEFAULT_EXCLUDE.length;
        console.error(
          pc.yellow(
            skipped.length > 0 || hasUserExcludes
              ? "No Docker Compose files to lint after applying exclusions."
              : "No Docker Compose files found.",
          ),
        );
        const formatted = format(formatterName, [], allRules);
        if (formatted.trim()) console.log(formatted);
        process.exitCode = EXIT_OK;
        return;
      }

      const sources: SourceFile[] = [];
      for (const filePath of files) {
        try {
          sources.push({
            filePath,
            source: await readFile(filePath, "utf-8"),
          });
        } catch (error) {
          return fail(`cannot read "${filePath}": ${describeError(error)}`);
        }
      }

      // Files pulled in through `include:` are fragments, so they are treated as
      // partial without needing configuration. When explicit targets are given
      // (a pre-commit hook passing changed files, for example) the including file
      // may not be among them, so the project is scanned for the references.
      const includeIndexFiles =
        targets.length > 0
          ? await readIncludeIndex(baseDir, isExcluded, sources)
          : sources;
      const includedPaths = collectIncludedPaths(includeIndexFiles);

      const { results, fixedCount, previews, writeFailures } = await lintFiles({
        sources,
        rules: allRules,
        config,
        isPartial,
        includedPaths,
        fixMode: dryRun ? "dry-run" : args.fix ? "write" : "off",
      });

      // `--quiet` only changes what is printed, never whether the run passes.
      const displayResults = args.quiet
        ? results.map((result) => ({
            ...result,
            diagnostics: result.diagnostics.filter(
              (d) => d.severity === "error",
            ),
          }))
        : results;

      const formatted = format(formatterName, displayResults, allRules);
      if (formatted.trim()) {
        console.log(formatted);
      }

      if (fixedCount > 0) {
        const summary = pc.green(
          `\n✔ Fixed ${fixedCount} file${fixedCount > 1 ? "s" : ""}`,
        );
        if (formatterName === "stylish") console.log(summary);
        else console.error(summary);
      }

      if (previews.length > 0) {
        const stream =
          formatterName === "stylish" ? process.stdout : process.stderr;
        for (const { filePath, source } of previews) {
          stream.write(`\n--- ${filePath} (after fixes) ---\n`);
          stream.write(source);
          if (!source.endsWith("\n")) stream.write("\n");
        }
        stream.write(
          `\nWould fix ${previews.length} file${previews.length > 1 ? "s" : ""}\n`,
        );
      }

      for (const failure of writeFailures) {
        console.error(pc.red(`composelint: ${failure}`));
      }
      if (writeFailures.length > 0) {
        process.exitCode = EXIT_USAGE;
        return;
      }

      const decision = resolveExitCode(
        countDiagnostics(results),
        maxWarnings.value,
      );
      if (decision.message) {
        console.error(pc.red(`composelint: ${decision.message}`));
      }
      process.exitCode = decision.code;
    } catch (error) {
      return fail(`unexpected error: ${describeError(error)}`);
    }
  },
});

runMain(main);
