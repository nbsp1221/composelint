import {
  isAlias,
  isNode,
  type Node,
  type Pair,
  visit,
  type YAMLMap,
} from "yaml";
import type { ComposeDocument } from "../../core/document.js";
import {
  type ItemRange,
  type ReorderOptions,
  reorderEntries,
} from "../../core/text-edit.js";
import type { TextEdit } from "../../core/types.js";

/** Position of a key in the configured order; omitted keys sort last. */
function orderIndex(key: string, order: readonly string[]): number {
  const index = order.indexOf(key);
  return index === -1 ? order.length : index;
}

/**
 * The expected key sequence: keys mentioned in the configured order first,
 * followed by keys the order omits, keeping their relative positions.
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
 * Compare alias targets by node identity so a move cannot leave an alias
 * unresolved or bind it to a different anchor with the same name.
 */
function preservesAliasTargets(
  document: ComposeDocument,
  map: YAMLMap,
  order: readonly number[],
): boolean {
  let hasReferences = false;
  visit(map, {
    Node: (_key, node) => {
      if (isAlias(node) || node.anchor) {
        hasReferences = true;
        return visit.BREAK;
      }
    },
  });
  if (!hasReferences) return true;

  function aliasTargets(reorder: boolean) {
    const anchors = new Map<string, Node>();
    const targets = new Map<Node, Node | undefined>();
    function record(_key: unknown, node: Node) {
      if (isAlias(node)) targets.set(node, anchors.get(node.source));
      else if (node.anchor) anchors.set(node.anchor, node);
      if (reorder && node === map) {
        for (const index of order) {
          const { key, value } = map.items[index];
          if (isNode(key)) visit(key, { Node: record });
          if (isNode(value)) visit(value, { Node: record });
        }
        return visit.SKIP;
      }
    }
    visit(document.doc, { Node: record });
    return targets;
  }

  const reordered = aliasTargets(true);
  for (const [alias, target] of aliasTargets(false)) {
    if (reordered.get(alias) !== target) return false;
  }
  return true;
}

/**
 * Builds the edits that reorder `map` so that its orderable keys follow
 * `expected`, keeping pinned entries at the top and unknown entries in
 * their original slots.
 *
 * Returns null when the mapping cannot be rewritten as whole lines, which is
 * the case for flow mappings such as `web: {image: nginx, ports: []}`.
 */
export function buildReorderEdits(
  document: ComposeDocument,
  map: YAMLMap,
  isPinned: (key: string) => boolean,
  isUnknown: (key: string) => boolean,
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
  const unknownIndices = new Set<number>();
  const remaining = new Map<string, number[]>();

  map.items.forEach((pair, index) => {
    const key = document.pairKeyName(pair);
    if (isPinned(key)) {
      pinnedIndices.push(index);
      return;
    }
    if (isUnknown(key)) {
      unknownIndices.add(index);
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

  if (orderedIndices.length + unknownIndices.size !== items.length) return null;

  let next = 0;
  const order = items.map((_, index) =>
    unknownIndices.has(index) ? index : orderedIndices[next++],
  );
  if (!preservesAliasTargets(document, map, order)) return null;
  return reorderEntries(document.source, items, order, options);
}
