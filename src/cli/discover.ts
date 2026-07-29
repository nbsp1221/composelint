import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PathMatcher } from "../config/glob.js";

/**
 * File names treated as Compose files during directory discovery: the names
 * Compose itself looks for, plus the two conventions projects use for extra
 * files — a suffix (`compose.prod.yaml`) and a prefix (`prod.compose.yaml`).
 */
const COMPOSE_FILE_PATTERN =
  /^(?:(?:docker-)?compose(?:\..+)?|.+\.(?:docker-)?compose)\.ya?ml$/;

/** Recursively collects Compose files under `dir`, honouring `isExcluded`. */
export async function findComposeFiles(
  dir: string,
  isExcluded: PathMatcher,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (isExcluded(fullPath)) continue;

      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".")) {
          await walk(fullPath);
        }
      } else if (entry.isFile() && COMPOSE_FILE_PATTERN.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files.sort();
}

export interface ResolvedTargets {
  /** Files to lint, in stable order. */
  files: string[];
  /** Explicitly named files skipped because of `exclude`. */
  skipped: string[];
  /** Paths that could not be found on disk. */
  missing: string[];
}

/**
 * Turns command-line targets into a concrete file list. Directories are walked
 * recursively; explicitly named files are kept unless `exclude` matches them.
 * When no target is given, the current directory is walked.
 */
export async function resolveTargets(
  targets: string[],
  isExcluded: PathMatcher,
): Promise<ResolvedTargets> {
  if (targets.length === 0) {
    return {
      files: await findComposeFiles(".", isExcluded),
      skipped: [],
      missing: [],
    };
  }

  const files: string[] = [];
  const skipped: string[] = [];
  const missing: string[] = [];
  // The same file can be reached through several targets (`.` and `./a.yaml`,
  // or two spellings of one path); it should still be linted once.
  const seen = new Set<string>();

  const add = (filePath: string): void => {
    const key = resolve(filePath);
    if (seen.has(key)) return;
    seen.add(key);
    files.push(filePath);
  };

  for (const target of targets) {
    let isDirectory: boolean;
    try {
      isDirectory = (await stat(target)).isDirectory();
    } catch {
      missing.push(target);
      continue;
    }

    if (isDirectory) {
      for (const filePath of await findComposeFiles(target, isExcluded)) {
        add(filePath);
      }
    } else if (isExcluded(target)) {
      skipped.push(target);
    } else {
      add(target);
    }
  }

  return { files, skipped, missing };
}
