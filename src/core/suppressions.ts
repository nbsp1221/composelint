import { Parser } from "yaml";
import type { Rule, SourcePosition } from "./types.js";

/**
 * Suppression comments follow the convention shared by ESLint, Biome and
 * oxlint (hyphenated directives), while also accepting the space-separated
 * form used by yamllint and dclint:
 *
 * ```yaml
 * # composelint-disable-file                     # all rules, whole file
 * # composelint-disable-file no-unbound-ports              # one rule, whole file
 * # composelint-disable-next-line no-privileged  # the next content line
 * privileged: true  # composelint-disable-line no-privileged
 * # composelint-disable no-unbound-ports -- dev only       # range start
 * # composelint-enable no-unbound-ports                    # range end
 * ```
 *
 * Rules are named, separated by spaces or commas, optionally prefixed with
 * `rule:` for yamllint muscle memory. Everything after ` -- ` is treated as the
 * reason.
 */
const DIRECTIVE_PATTERN =
  /^#\s*composelint[-\s](disable-file|disable-next-line|disable-line|disable|enable)(?=$|[\s,])(.*)$/;

/**
 * A comment that means to be a directive but does not spell the tool's name the
 * way the directive parser requires. `compose-lint-disable-line` is the obvious
 * one to write for a Compose linter, and it would otherwise be an ordinary
 * comment: silently doing nothing is the worst outcome for a suppression.
 */
const NEAR_MISS_PATTERN =
  /^#\s*(compose[-_\s]?lint|composelinter|compose)[-_\s]?(disable-file|disable-next-line|disable-line|disable|enable)(?=$|[\s,])/i;

const REASON_SEPARATOR = /\s--\s|\s--$/;

/** Diagnostic id used for problems with the suppression comments themselves. */
export const SUPPRESSION_RULE_ID = "suppression";

export type SuppressionKind =
  | "disable-file"
  | "disable-line"
  | "disable-next-line"
  | "disable"
  | "enable";

export interface SuppressionDirective {
  kind: SuppressionKind;
  /** Resolved rule ids, or null when the directive targets every rule. */
  ruleIds: string[] | null;
  /** Rule keys that do not match any known rule. */
  unknownRuleKeys: string[];
  /** 1-based line of the comment itself. */
  commentLine: number;
  /** 1-based column of the comment itself. */
  commentColumn: number;
  /**
   * Lines a line-scoped directive covers: its target line plus every line
   * indented under it, so a comment above `ports:` also covers that list.
   */
  target?: { start: number; end: number };
  reason?: string;
  raw: string;
}

export interface SuppressionProblem {
  message: string;
  position: SourcePosition;
}

export interface Suppressions {
  /** All directives found in the document, in source order. */
  directives: SuppressionDirective[];
  /**
   * Whether `ruleId` is suppressed on `line`. Calling this marks the matching
   * directive as used, so it must be called while collecting diagnostics.
   */
  isSuppressed: (ruleId: string, line: number) => boolean;
  /** Problems with the comments themselves; call after linting has finished. */
  problems: () => SuppressionProblem[];
}

interface Range {
  ruleId: string | "*";
  start: number;
  end: number;
  directiveIndex: number;
}

interface RawComment {
  offset: number;
  source: string;
}

/** Collects YAML comment tokens with exact offsets from the CST. */
function collectComments(source: string): RawComment[] {
  const comments: RawComment[] = [];
  const seen = new Set<number>();

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;

    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }

    const candidate = node as {
      type?: unknown;
      offset?: unknown;
      source?: unknown;
    };
    if (
      candidate.type === "comment" &&
      typeof candidate.offset === "number" &&
      typeof candidate.source === "string" &&
      !seen.has(candidate.offset)
    ) {
      seen.add(candidate.offset);
      comments.push({ offset: candidate.offset, source: candidate.source });
    }

    for (const value of Object.values(node)) walk(value);
  };

  try {
    for (const token of new Parser().parse(source)) walk(token);
  } catch {
    // A document that cannot be parsed reports a YAML error instead; there is
    // nothing to suppress in that case.
    return [];
  }

  return comments.sort((a, b) => a.offset - b.offset);
}

function offsetToPosition(source: string, offset: number): SourcePosition {
  let line = 1;
  let lastNewline = -1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

/** True when the line holds nothing but whitespace or a comment. */
function isBlankOrComment(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/**
 * The line a `disable-line` / `disable-next-line` comment applies to. Blank and
 * comment-only lines are skipped so that stacked directives all resolve to the
 * same content line, matching yamllint's behaviour.
 */
function nextContentLine(lines: string[], commentLine: number): number {
  let line = commentLine + 1;
  while (line <= lines.length && isBlankOrComment(lines[line - 1])) {
    line++;
  }
  return line;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Last line of the block introduced by `targetLine`: the target line itself
 * plus any following lines indented deeper than it. This lets a directive
 * placed above a mapping key cover the values nested under that key, which is
 * where rules such as `no-unbound-ports` report their diagnostics.
 */
function blockEndLine(lines: string[], targetLine: number): number {
  const target = lines[targetLine - 1];
  if (target === undefined) return targetLine;

  const baseIndent = indentOf(target);
  let end = targetLine;

  for (let line = targetLine + 1; line <= lines.length; line++) {
    const text = lines[line - 1] ?? "";
    if (text.trim() === "") continue;
    if (indentOf(text) > baseIndent) {
      end = line;
      continue;
    }
    break;
  }

  return end;
}

function parseDirective(
  comment: RawComment,
  source: string,
  lines: string[],
  knownRules: ReadonlySet<string>,
): SuppressionDirective | null {
  const match = DIRECTIVE_PATTERN.exec(comment.source.trim());
  if (!match) return null;

  const kind = match[1] as SuppressionKind;
  const rest = match[2] ?? "";

  const separatorMatch = REASON_SEPARATOR.exec(rest);
  const rulePart = separatorMatch ? rest.slice(0, separatorMatch.index) : rest;
  const reason = separatorMatch
    ? rest.slice(separatorMatch.index + separatorMatch[0].length).trim()
    : undefined;

  const ruleKeys = rulePart
    .split(/[\s,]+/)
    .map((key) => key.trim().replace(/^rule:/, ""))
    .filter((key) => key !== "");

  const ruleIds: string[] = [];
  const unknownRuleKeys: string[] = [];
  for (const key of ruleKeys) {
    if (knownRules.has(key)) ruleIds.push(key);
    else unknownRuleKeys.push(key);
  }

  const { line: commentLine, column: commentColumn } = offsetToPosition(
    source,
    comment.offset,
  );

  const directive: SuppressionDirective = {
    kind,
    ruleIds: ruleKeys.length === 0 ? null : ruleIds,
    unknownRuleKeys,
    commentLine,
    commentColumn,
    reason: reason === "" ? undefined : reason,
    raw: comment.source.trim(),
  };

  if (kind === "disable-line" || kind === "disable-next-line") {
    // A trailing comment applies to its own line; a comment on its own line
    // applies to the next content line.
    const ownLine = lines[commentLine - 1] ?? "";
    const trailing = kind === "disable-line" && !ownLine.trim().startsWith("#");
    const start = trailing ? commentLine : nextContentLine(lines, commentLine);
    directive.target = { start, end: blockEndLine(lines, start) };
  }

  return directive;
}

function buildRanges(
  directives: SuppressionDirective[],
  lineCount: number,
): Range[] {
  const ranges: Range[] = [];
  const open = new Map<string, { start: number; directiveIndex: number }>();

  directives.forEach((directive, index) => {
    if (directive.kind === "disable") {
      const keys = directive.ruleIds === null ? ["*"] : directive.ruleIds;
      for (const key of keys) {
        if (!open.has(key)) {
          open.set(key, {
            start: directive.commentLine,
            directiveIndex: index,
          });
        }
      }
      return;
    }

    if (directive.kind === "enable") {
      const keys =
        directive.ruleIds === null ? [...open.keys()] : directive.ruleIds;
      for (const key of keys) {
        const opened = open.get(key);
        if (!opened) continue;
        ranges.push({
          ruleId: key as string | "*",
          start: opened.start,
          end: directive.commentLine,
          directiveIndex: opened.directiveIndex,
        });
        open.delete(key);
      }
    }
  });

  for (const [key, opened] of open) {
    ranges.push({
      ruleId: key as string | "*",
      start: opened.start,
      end: lineCount + 1,
      directiveIndex: opened.directiveIndex,
    });
  }

  return ranges;
}

export function createSuppressions(
  source: string,
  rules: Rule[],
): Suppressions {
  const knownRules = new Set(rules.map((rule) => rule.meta.name));

  const lines = source.split("\n");
  const directives: SuppressionDirective[] = [];
  const misspelled: SuppressionProblem[] = [];
  for (const comment of collectComments(source)) {
    const directive = parseDirective(comment, source, lines, knownRules);
    if (directive) {
      directives.push(directive);
      continue;
    }
    const text = comment.source.trim();
    const nearMiss = NEAR_MISS_PATTERN.exec(text);
    if (nearMiss) {
      misspelled.push({
        message: `Suppression comment "${nearMiss[0].trim()}" is not recognised — write "composelint-${nearMiss[2]}"`,
        position: offsetToPosition(source, comment.offset),
      });
    }
  }

  const ranges = buildRanges(directives, lines.length);
  const used = new Set<number>();

  const covers = (directive: SuppressionDirective, ruleId: string): boolean =>
    directive.ruleIds === null || directive.ruleIds.includes(ruleId);

  const isSuppressed = (ruleId: string, line: number): boolean => {
    let suppressed = false;

    directives.forEach((directive, index) => {
      if (!covers(directive, ruleId)) return;

      const matches =
        directive.kind === "disable-file" ||
        (directive.target !== undefined &&
          line >= directive.target.start &&
          line <= directive.target.end);

      if (matches) {
        used.add(index);
        suppressed = true;
      }
    });

    for (const range of ranges) {
      if (range.ruleId !== "*" && range.ruleId !== ruleId) continue;
      if (line < range.start || line >= range.end) continue;
      used.add(range.directiveIndex);
      suppressed = true;
    }

    return suppressed;
  };

  const problems = (): SuppressionProblem[] => {
    const found: SuppressionProblem[] = [...misspelled];
    const openedDisables = new Set(ranges.map((range) => range.directiveIndex));

    directives.forEach((directive, index) => {
      const position: SourcePosition = {
        line: directive.commentLine,
        column: directive.commentColumn,
      };

      for (const key of directive.unknownRuleKeys) {
        found.push({
          message: `Unknown rule "${key}" in suppression comment — it suppresses nothing`,
          position,
        });
      }

      if (directive.kind === "enable") {
        const hasMatchingDisable = ranges.some(
          (range) => range.end === directive.commentLine,
        );
        if (!hasMatchingDisable) {
          found.push({
            message:
              'Suppression comment "composelint-enable" has no matching "composelint-disable"',
            position,
          });
        }
        return;
      }

      // A directive whose only rule keys were unknown is already reported.
      if (
        directive.ruleIds !== null &&
        directive.ruleIds.length === 0 &&
        directive.unknownRuleKeys.length > 0
      ) {
        return;
      }

      if (directive.kind === "disable" && !openedDisables.has(index)) {
        return;
      }

      if (!used.has(index)) {
        found.push({
          message: `Unused suppression comment "${directive.raw}" — no diagnostics were suppressed`,
          position,
        });
      }
    });

    return found;
  };

  return { directives, isSuppressed, problems };
}
