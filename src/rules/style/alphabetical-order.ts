import {
  type CST,
  isMap,
  isScalar,
  type Scalar,
  visit,
  type YAMLMap,
  type YAMLSeq,
} from "yaml";
import { type ItemRange, reorderEntries } from "../../core/text-edit.js";
import type { RuleContext } from "../../core/types.js";
import { itemRangeOf } from "./ordering.js";

interface NamedEntry {
  name: string;
  node: Scalar<string>;
  range: ItemRange | null;
}

function isName(node: unknown): node is Scalar<string> {
  return (
    isScalar(node) &&
    typeof node.value === "string" &&
    /^[A-Za-z0-9._-]+$/.test(node.value)
  );
}

function namedMappingEntries(map: YAMLMap): NamedEntry[] {
  return map.items.flatMap((pair) =>
    isName(pair.key)
      ? [
          {
            name: pair.key.value,
            node: pair.key,
            range: pair.srcToken?.start.some(
              ({ type }) => type === "explicit-key-ind",
            )
              ? null
              : itemRangeOf(pair, true),
          },
        ]
      : [],
  );
}

function namedSequenceEntries(sequence: YAMLSeq): NamedEntry[] {
  const tokens = (sequence as YAMLSeq & { srcToken?: CST.Token }).srcToken;
  return sequence.items.flatMap((node, index) => {
    if (!isName(node)) return [];
    const dash =
      tokens?.type === "block-seq"
        ? tokens.items[index]?.start.find(({ type }) => type === "seq-item-ind")
        : undefined;
    return [
      {
        name: node.value,
        node,
        range:
          dash && node.range && !node.tag
            ? { keyStart: dash.offset, valueEnd: node.range[2] }
            : null,
      },
    ];
  });
}

function canMoveCollection(collection: YAMLMap | YAMLSeq): boolean {
  if (collection.flow) return false;
  if (collection.tag && collection.tag !== "!override") return false;

  // A moved block scalar can gain or lose trailing blank lines.
  let multilineScalar = false;
  visit(collection, {
    Scalar: (_key, node) => {
      const token = (
        node as Scalar & { srcToken?: CST.FlowScalar | CST.BlockScalar }
      ).srcToken;
      if (token?.type === "block-scalar" || token?.source.includes("\n")) {
        multilineScalar = true;
        return visit.BREAK;
      }
    },
  });
  return !multilineScalar;
}

function hasNearbyDirective(
  source: string,
  start: number,
  end: number,
): boolean {
  const directive = /#\s*composelint[-\s](?:disable|enable)/;
  if (directive.test(source.slice(start, end))) return true;

  // A directive above the edited block can target its first entry across gaps.
  let boundary = start;
  while (boundary > 0) {
    const previous =
      boundary === 1 ? 0 : source.lastIndexOf("\n", boundary - 2) + 1;
    const line = source.slice(previous, boundary).trim();
    if (line && !line.startsWith("#")) break;
    if (directive.test(line)) return true;
    boundary = previous;
  }
  return false;
}

function hasShallowComment(source: string, range: ItemRange): boolean {
  const lineStart = source.lastIndexOf("\n", range.keyStart - 1) + 1;
  const indent = range.keyStart - lineStart;
  return source
    .slice(range.keyStart, range.valueEnd)
    .split("\n")
    .slice(1)
    .some(
      (line) => line.trimStart().startsWith("#") && line.search(/\S/) < indent,
    );
}

export function reportAlphabeticalOrder(
  context: RuleContext,
  collection: YAMLMap | YAMLSeq,
  message: (actual: string, expected: string) => string,
  canFix = true,
): void {
  const entries = isMap(collection)
    ? namedMappingEntries(collection)
    : namedSequenceEntries(collection);
  // Sort literal names only. Merged, aliased and non-string entries have
  // no reliable local position to compare with the other names.
  if (entries.length !== collection.items.length) return;
  if (new Set(entries.map(({ name }) => name)).size !== entries.length) return;

  const sorted = entries
    .map(({ name }, index) => ({ name, index }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const first = entries.findIndex(
    ({ name }, index) => name !== sorted[index].name,
  );
  if (first === -1) return;

  const { document } = context;
  context.report({
    node: entries[first].node,
    message: message(entries[first].name, sorted[first].name),
    fix: () => {
      if (!canFix || !canMoveCollection(collection)) return null;
      const ranges = entries.map(({ range }) => range);
      if (!ranges.every((range): range is ItemRange => range !== null))
        return null;
      if (ranges.some((range) => hasShallowComment(document.source, range)))
        return null;
      const edits = reorderEntries(
        document.source,
        ranges,
        sorted.map(({ index }) => index),
        {
          includeLeadingComments: true,
          newline: document.source.match(/\r?\n/)?.[0],
        },
      );
      return edits?.some(
        ({ start, end }) =>
          document.hasAnchorDependency(start, end) ||
          hasNearbyDirective(document.source, start, end),
      )
        ? null
        : edits;
    },
  });
}
