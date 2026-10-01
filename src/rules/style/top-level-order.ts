import type { Rule, RuleContext } from "../../core/types.js";
import { DEFAULT_TOP_LEVEL_ORDER, schemaTopLevelKeys } from "./key-order.js";
import { buildReorderEdits, expectedOrder } from "./ordering.js";

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
    // `x-*`, obsolete `version`, and schema-undefined keys are pinned.
    // Reordering keeps the pinned entries together in source order while it
    // reorders only schema-defined keys.
    const isPinned = (key: string): boolean =>
      key.startsWith("x-") || key === "version" || !schemaTopLevelKeys.has(key);
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
