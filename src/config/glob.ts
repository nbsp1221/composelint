import { isAbsolute, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";

export interface PathMatcher {
  /** Returns true when the given file path matches the patterns. */
  (filePath: string): boolean;
  /** Whether the walker can skip this directory and all its contents. */
  canPruneDirectory(directory: string): boolean;
}

interface CompiledPattern {
  negated: boolean;
  isMatch: (path: string) => boolean;
  prefix: string;
}

function compile(pattern: string): CompiledPattern | null {
  const negated = pattern.startsWith("!");
  const body = (negated ? pattern.slice(1) : pattern).trim();
  if (body === "") return null;

  // A trailing slash (or a bare directory name) should match everything inside
  // that directory, so match both the entry itself and its contents.
  const normalized = body.replace(/\/+$/, "");
  const isMatch = picomatch([normalized, `${normalized}/**`], { dot: true });

  // Escapes and alternation can make the scan report an unsafe prefix.
  const prefix =
    negated && !/[\\|!]/.test(normalized)
      ? picomatch.scan(normalized).base
      : "";
  return { negated, isMatch, prefix };
}

/**
 * Builds a glob matcher with ESLint-like semantics:
 *
 * - Appended patterns run last and may have a different base directory.
 * - `dist` and `dist/` both match the whole directory.
 * - Patterns starting with `!` un-match previously matched paths.
 * - Later patterns win, so order matters.
 * - Paths outside `baseDir` never match.
 */
export function createPathMatcher(
  patterns: string[],
  baseDir: string,
  appended?: { patterns: string[]; baseDir: string },
): PathMatcher {
  const groups = (
    appended ? [{ patterns, baseDir }, appended] : [{ patterns, baseDir }]
  ).map(({ patterns, baseDir }) => ({
    baseDir,
    compiled: patterns
      .map(compile)
      .filter((entry): entry is CompiledPattern => entry !== null),
  }));
  const reincludePrefixes = groups.flatMap(({ baseDir, compiled }) =>
    compiled
      .filter(({ negated }) => negated)
      .map(({ prefix }) => resolve(baseDir, prefix)),
  );

  const matcher = (filePath: string): boolean => {
    const absolute = resolve(filePath);
    let matched = false;
    for (const { baseDir, compiled } of groups) {
      const relativePath = toRelativePosix(absolute, baseDir);
      if (!relativePath) continue;
      for (const { negated, isMatch } of compiled) {
        if (isMatch(relativePath)) matched = !negated;
      }
    }
    return matched;
  };

  matcher.canPruneDirectory = (directory: string): boolean =>
    matcher(directory) &&
    !reincludePrefixes.some(
      (prefix) =>
        toRelativePosix(prefix, directory) !== null ||
        toRelativePosix(directory, prefix) !== null,
    );
  return matcher;
}

function toRelativePosix(filePath: string, baseDir: string): string | null {
  // File paths come from the command line or the file walker, so they are
  // relative to the current working directory, not to the config directory.
  const relativePath = relative(baseDir, filePath);
  if (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return null;
  }
  return relativePath.split(sep).join("/");
}
