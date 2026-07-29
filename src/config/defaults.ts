/**
 * Path patterns applied before any user configuration.
 */

/**
 * Always excluded, regardless of configuration. Kept in sync with the
 * directories skipped while walking the file tree.
 */
export const DEFAULT_EXCLUDE = [
  "**/node_modules",
  "**/.git",
  "**/dist",
  "**/vendor",
];

/**
 * Files that are not projects on their own: an override file patches a base
 * file, so rules that ask a question about the project as a whole ("is there a
 * project name?", "does this service have a healthcheck?") cannot be answered
 * from them. Fragments with project-specific names are declared with the
 * `partials` option instead.
 */
export const DEFAULT_PARTIALS = ["**/*.override.yaml", "**/*.override.yml"];
