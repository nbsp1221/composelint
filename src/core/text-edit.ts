import type { TextEdit } from "./types.js";

/**
 * Fixes are expressed as edits to the original source text rather than as AST
 * mutations, so bytes that are not part of a fix are preserved exactly. This is
 * the same model ESLint uses, and it avoids the reformatting that comes with
 * re-serializing a whole YAML document (line wrapping, flow collection padding,
 * comment spacing).
 */

/** Offsets of the start of every line, for offset↔line conversions. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineIndexAt(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Start offset of the line containing `offset`. */
function lineStartOf(source: string, starts: number[], offset: number): number {
  return starts[
    lineIndexAt(starts, Math.max(0, Math.min(offset, source.length)))
  ];
}

/** End offset (past the newline) of the line containing `offset`. */
function lineEndOf(source: string, starts: number[], offset: number): number {
  const index = lineIndexAt(
    starts,
    Math.max(0, Math.min(offset, source.length)),
  );
  const next = starts[index + 1];
  return next === undefined ? source.length : next;
}

/**
 * Applies edits to `source`, skipping any edit that overlaps one already
 * applied. Skipped edits are reported so the caller can run another pass.
 */
export function applyEdits(
  source: string,
  edits: readonly TextEdit[],
): { output: string; applied: number; deferred: number } {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);

  let output = "";
  let cursor = 0;
  let applied = 0;
  let deferred = 0;

  for (const edit of sorted) {
    if (edit.start < cursor || edit.start > edit.end) {
      deferred++;
      continue;
    }
    output += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
    applied++;
  }

  output += source.slice(cursor);
  return { output, applied, deferred };
}

/** Source range of one mapping entry: from the key start to the value end. */
export interface ItemRange {
  keyStart: number;
  valueEnd: number;
}

/**
 * Removes the whole lines occupied by one mapping entry.
 *
 * Comment lines above the entry are deliberately left alone: a comment sitting
 * at the top of a file is attached to the first key by the YAML parser, and
 * deleting it with the key would silently drop a file header.
 */
export function deleteEntryLines(
  source: string,
  item: ItemRange,
): TextEdit[] | null {
  if (!Number.isInteger(item.keyStart) || !Number.isInteger(item.valueEnd)) {
    return null;
  }

  const starts = lineStarts(source);
  const start = lineStartOf(source, starts, item.keyStart);
  const end = lineEndOf(
    source,
    starts,
    Math.max(item.valueEnd - 1, item.keyStart),
  );
  if (end <= start) return null;

  return [{ start, end, text: "" }];
}

interface Segment {
  start: number;
  end: number;
}

export interface ReorderOptions {
  /**
   * Whether comment lines directly above the *first* entry belong to it.
   *
   * True for nested mappings (a comment above a service's first key documents
   * that key). False at the top level, where such a comment is usually a file
   * header that must stay at the top of the file.
   */
  includeLeadingComments?: boolean;
}

/** Indentation width of the line starting at `start`. */
function indentWidthAt(source: string, start: number): number {
  let width = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === " " || char === "\t") width++;
    else break;
  }
  return width;
}

/**
 * End of the final entry's own block.
 *
 * The parser reports a range that runs to the next token, so for the last entry
 * of a mapping it can reach into a sibling — a trailing comment inside a
 * service, for instance, pushes the range down into the next service. Rewriting
 * that far would move another mapping's lines and duplicate its keys, so the
 * region is cut back to the last line indented at least as far as this entry's
 * own key. Lines at a shallower indent (a section comment introducing what
 * comes next) stay where they are.
 */
function blockEnd(
  source: string,
  starts: number[],
  keyLineStart: number,
  reportedEnd: number,
): number {
  const indent = indentWidthAt(source, keyLineStart);
  let end = lineEndOf(source, starts, keyLineStart);

  for (const lineStart of starts) {
    if (lineStart <= keyLineStart) continue;
    if (lineStart >= reportedEnd) break;
    const lineEnd = lineEndOf(source, starts, lineStart);
    const text = source.slice(lineStart, lineEnd);
    if (text.trim() === "") continue;
    if (indentWidthAt(source, lineStart) < indent) break;
    end = lineEnd;
  }

  return Math.min(end, reportedEnd);
}

/**
 * Splits the region covered by `items` into one contiguous segment per entry.
 *
 * Each segment ends at the end of the entry's last line, and starts where the
 * previous segment ended. Interstitial lines (blank lines, section comments)
 * therefore belong to the entry that follows them and travel with it, while
 * anything above the first entry stays where it is unless
 * `includeLeadingComments` is set.
 */
function toSegments(
  source: string,
  items: readonly ItemRange[],
  options: ReorderOptions = {},
): Segment[] | null {
  if (items.length === 0) return null;

  const starts = lineStarts(source);
  const segments: Segment[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!Number.isInteger(item.keyStart) || !Number.isInteger(item.valueEnd)) {
      return null;
    }

    const keyLineStart = lineStartOf(source, starts, item.keyStart);

    // A block value whose last line is a comment reports a range that reaches
    // into the next entry's line, because the parser stops at the next token
    // rather than at the end of its own content. Clamping to the line the next
    // entry starts on keeps such a comment inside the entry it documents and
    // stops the segments from overlapping — an overlap made the whole mapping
    // unfixable.
    const nextItem = items[i + 1];
    const reported = lineEndOf(
      source,
      starts,
      Math.max(item.valueEnd - 1, item.keyStart),
    );
    const end =
      nextItem === undefined
        ? blockEnd(source, starts, keyLineStart, reported)
        : Math.min(reported, lineStartOf(source, starts, nextItem.keyStart));

    let start: number;
    if (i > 0) {
      start = segments[i - 1].end;
    } else if (options.includeLeadingComments) {
      start = commentRunStart(source, starts, keyLineStart);
    } else {
      start = keyLineStart;
    }

    // Entries must occupy their own lines and appear in document order, which
    // rules out flow mappings such as `{a: 1, b: 2}`.
    if (start > keyLineStart || end <= start) return null;

    segments.push({ start, end });
  }

  return segments;
}

/**
 * Start of the run of comment lines immediately above `keyLineStart` that are
 * indented at least as much as the key itself.
 */
function commentRunStart(
  source: string,
  starts: number[],
  keyLineStart: number,
): number {
  const keyIndent = indentWidthAt(source, keyLineStart);
  let start = keyLineStart;
  let index = lineIndexAt(starts, keyLineStart) - 1;

  while (index >= 0) {
    const lineStart = starts[index];
    const lineEnd = starts[index + 1] ?? source.length;
    const text = source.slice(lineStart, lineEnd);
    const trimmed = text.trim();
    if (!trimmed.startsWith("#")) break;
    if (indentWidthAt(source, lineStart) < keyIndent) break;
    start = lineStart;
    index--;
  }

  return start;
}

/**
 * Rewrites a mapping so its entries appear in `order` (indices into `items`).
 * Returns null when the mapping cannot be reordered as whole lines.
 */
export function reorderEntries(
  source: string,
  items: readonly ItemRange[],
  order: readonly number[],
  options: ReorderOptions = {},
): TextEdit[] | null {
  if (order.length !== items.length) return null;

  const segments = toSegments(source, items, options);
  if (!segments) return null;

  const seen = new Set<number>();
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return null;
    }
    if (seen.has(index)) return null;
    seen.add(index);
  }

  const start = segments[0].start;
  const end = segments[segments.length - 1].end;
  const original = source.slice(start, end);
  const endsWithNewline = original.endsWith("\n");

  const parts = order.map((index) => {
    const text = source.slice(segments[index].start, segments[index].end);
    return text.endsWith("\n") ? text : `${text}\n`;
  });

  let text = parts.join("");
  if (!endsWithNewline) text = text.replace(/\n$/, "");

  if (text === original) return null;

  return [{ start, end, text }];
}
