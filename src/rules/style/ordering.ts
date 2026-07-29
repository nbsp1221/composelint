import type { Pair, YAMLMap } from "yaml";
import type { ComposeDocument } from "../../core/document.js";
import {
  type ItemRange,
  type ReorderOptions,
  reorderEntries,
} from "../../core/text-edit.js";
import type { TextEdit } from "../../core/types.js";

/** Position of a key in the configured order; unknown keys sort last. */
function orderIndex(key: string, order: readonly string[]): number {
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
}

/**
 * The expected key sequence: known keys in the configured order, then keys the
 * order does not mention, keeping their relative positions.
 */
export function expectedOrder(
  keys: readonly string[],
  order: readonly string[],
): string[] {
  const known = keys.filter((key) => order.includes(key));
  const unknown = keys.filter((key) => !order.includes(key));
  const sortedKnown = [...known].sort(
    (a, b) => orderIndex(a, order) - orderIndex(b, order),
  );
  return [...sortedKnown, ...unknown];
}

function itemRangeOf(pair: Pair): ItemRange | null {
  const keyStart = (pair.key as { range?: [number, number, number] } | null)
    ?.range?.[0];
  const valueEnd =
    (pair.value as { range?: [number, number, number] } | null)?.range?.[1] ??
    (pair.key as { range?: [number, number, number] } | null)?.range?.[1];

  if (keyStart === undefined || valueEnd === undefined) return null;
  return { keyStart, valueEnd };
}

/**
 * Builds the edits that reorder `map` so that its orderable keys follow
 * `expected`, keeping position-independent keys (`x-*`, `<<`) at the top.
 *
 * Returns null when the mapping cannot be rewritten as whole lines, which is
 * the case for flow mappings such as `web: {image: nginx, ports: []}`.
 */
export function buildReorderEdits(
  document: ComposeDocument,
  map: YAMLMap,
  isPinned: (key: string) => boolean,
  expected: readonly string[],
  options: ReorderOptions = {},
): TextEdit[] | null {
  if (map.flow) return null;

  const items: ItemRange[] = [];
  for (const pair of map.items) {
    const range = itemRangeOf(pair);
    if (!range) return null;
    items.push(range);
  }

  const pinnedIndices: number[] = [];
  const remaining = new Map<string, number[]>();

  map.items.forEach((pair, index) => {
    const key = document.pairKeyName(pair);
    if (isPinned(key)) {
      pinnedIndices.push(index);
      return;
    }
    const bucket = remaining.get(key);
    if (bucket) bucket.push(index);
    else remaining.set(key, [index]);
  });

  const orderedIndices: number[] = [...pinnedIndices];
  for (const key of expected) {
    const bucket = remaining.get(key);
    const index = bucket?.shift();
    // A key the linter expected is missing from the map: refuse to guess.
    if (index === undefined) return null;
    orderedIndices.push(index);
  }

  if (orderedIndices.length !== items.length) return null;

  return reorderEntries(document.source, items, orderedIndices, options);
}
