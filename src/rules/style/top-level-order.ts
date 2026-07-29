import type { Rule, RuleContext } from "../../core/types.js";
import { DEFAULT_TOP_LEVEL_ORDER } from "./key-order.js";
import { buildReorderEdits, expectedOrder } from "./ordering.js";

/**
 * Keys that are not ordered: `x-*` extension fields may appear anywhere, and
 * `version` is obsolete, so no-version-field asks for its removal instead of a position.
 */
function isPinned(key: string): boolean {
  return key.startsWith("x-") || key === "version";
}

export const topLevelOrder: Rule = {
  meta: {
    name: "top-level-order",
    category: "style",
    description: "Top-level keys should follow a specific order",
    fixable: true,
    defaultSeverity: "warn",
    options: { order: "string[]" },
  },
  create(context: RuleContext) {
    const order =
      (context.options.order as string[] | undefined) ??
      DEFAULT_TOP_LEVEL_ORDER;
    const root = context.document.root;
    if (!root) return;

    const orderable = root.items.filter(
      (pair) => !isPinned(context.document.pairKeyName(pair)),
    );
    const keys = orderable.map((pair) => context.document.pairKeyName(pair));
    const expected = expectedOrder(keys, order);

    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === expected[i]) continue;

      context.report({
        message: `Top-level key "${keys[i]}" should appear ${
          expected.indexOf(keys[i]) < i ? "earlier" : "later"
        } (expected "${expected[i]}" at position ${i + 1})`,
        node: orderable[i].key as { range?: [number, number, number] },
        fix: () =>
          buildReorderEdits(context.document, root, isPinned, expected),
      });
      break;
    }
  },
};
