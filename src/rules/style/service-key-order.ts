import type { Rule, RuleContext } from "../../core/types.js";
import { DEFAULT_SERVICE_KEY_ORDER } from "./key-order.js";
import { buildReorderEdits, expectedOrder } from "./ordering.js";

/** Merge keys and `x-*` extensions may appear anywhere within a service. */
function isPinned(key: string): boolean {
  return key === "<<" || key.startsWith("x-");
}

export const serviceKeyOrder: Rule = {
  meta: {
    name: "service-key-order",
    category: "style",
    description: "Keys within each service should follow a specific order",
    fixable: true,
    defaultSeverity: "warn",
    options: { order: "string[]" },
  },
  create(context: RuleContext) {
    const order =
      (context.options.order as string[] | undefined) ??
      DEFAULT_SERVICE_KEY_ORDER;
    const servicesMap = context.document.getServicesMap();
    if (!servicesMap) return;

    for (const servicePair of servicesMap.items) {
      const serviceName = context.document.pairKeyName(servicePair);
      const svcMap = context.document.getServiceMap(serviceName);
      if (!svcMap) continue;

      const orderable = svcMap.items.filter(
        (pair) => !isPinned(context.document.pairKeyName(pair)),
      );
      const keys = orderable.map((pair) => context.document.pairKeyName(pair));
      const expected = expectedOrder(keys, order);

      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === expected[i]) continue;

        context.report({
          message: `Service "${serviceName}": key "${keys[i]}" is out of order (expected "${expected[i]}" at position ${i + 1})`,
          node: orderable[i].key as { range?: [number, number, number] },
          fix: () =>
            buildReorderEdits(context.document, svcMap, isPinned, expected, {
              includeLeadingComments: true,
            }),
        });
        break;
      }
    }
  },
};
