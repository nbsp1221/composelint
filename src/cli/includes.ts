import { dirname, resolve } from "node:path";
import { ComposeDocument } from "../core/document.js";

export interface SourceFile {
  filePath: string;
  source: string;
}

function pushPath(target: Set<string>, baseDir: string, value: unknown): void {
  if (typeof value === "string" && value !== "") {
    target.add(resolve(baseDir, value));
  }
}

/**
 * Absolute paths of every file referenced through a top-level `include:`.
 *
 * An included file carries a slice of the project, so rules that need the whole
 * project would report on it incorrectly. Detecting the references means users
 * do not have to declare fragments by hand when they follow `include:`.
 */
export function collectIncludedPaths(
  files: readonly SourceFile[],
): Set<string> {
  const included = new Set<string>();

  for (const file of files) {
    let data: unknown;
    try {
      data = new ComposeDocument(file.source, file.filePath).toJS();
    } catch {
      continue;
    }

    if (typeof data !== "object" || data === null) continue;
    const include = (data as { include?: unknown }).include;
    if (!Array.isArray(include)) continue;

    const baseDir = dirname(resolve(file.filePath));

    for (const entry of include) {
      if (typeof entry === "string") {
        pushPath(included, baseDir, entry);
        continue;
      }

      if (typeof entry !== "object" || entry === null) continue;
      const path = (entry as { path?: unknown }).path;
      if (Array.isArray(path)) {
        for (const item of path) pushPath(included, baseDir, item);
      } else {
        pushPath(included, baseDir, path);
      }
    }
  }

  return included;
}
