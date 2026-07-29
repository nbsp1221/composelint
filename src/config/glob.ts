import { relative, resolve, sep } from "node:path";
import picomatch from "picomatch";

export interface PathMatcher {
  /** Returns true when the given file path matches the patterns. */
  (filePath: string): boolean;
  /** The patterns this matcher was built from, in evaluation order. */
  patterns: string[];
}

interface CompiledPattern {
  negated: boolean;
  isMatch: (path: string) => boolean;
}

function compile(pattern: string): CompiledPattern | null {
  const negated = pattern.startsWith("!");
  const body = (negated ? pattern.slice(1) : pattern).trim();
  if (body === "") return null;

  // A trailing slash (or a bare directory name) should match everything inside
  // that directory, so match both the entry itself and its contents.
  const normalized = body.replace(/\/+$/, "");
  const isMatch = picomatch([normalized, `${normalized}/**`], { dot: true });

  return { negated, isMatch };
}

/**
 * Builds a glob matcher with ESLint-like semantics:
 *
 * - Patterns are resolved relative to `baseDir` (the directory of the
 *   configuration file, or the current working directory when there is none).
 * - `dist` and `dist/` both match the whole directory.
 * - Patterns starting with `!` un-match previously matched paths.
 * - Later patterns win, so order matters.
 * - Paths outside `baseDir` never match.
 */
export function createPathMatcher(
  patterns: string[],
  baseDir: string,
): PathMatcher {
  const compiled = patterns
    .map(compile)
    .filter((entry): entry is CompiledPattern => entry !== null);

  const matcher = (filePath: string): boolean => {
    const relativePath = toRelativePosix(filePath, baseDir);
    if (relativePath === null) return false;

    let matched = false;
    for (const { negated, isMatch } of compiled) {
      if (isMatch(relativePath)) matched = !negated;
    }
    return matched;
  };

  matcher.patterns = patterns;
  return matcher;
}

function toRelativePosix(filePath: string, baseDir: string): string | null {
  // File paths come from the command line or the file walker, so they are
  // relative to the current working directory, not to the config directory.
  const relativePath = relative(resolve(baseDir), resolve(filePath));
  if (relativePath === "" || relativePath.startsWith("..")) return null;
  return relativePath.split(sep).join("/");
}
