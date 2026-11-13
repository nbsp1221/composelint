import { isMap, isSeq } from "yaml";
import type { Rule } from "../../core/types.js";
import { reportAlphabeticalOrder } from "./alphabetical-order.js";

export const serviceDependenciesAlphabeticalOrder: Rule = {
  meta: {
    name: "service-dependencies-alphabetical-order",
    category: "style",
    description: "Service dependencies should be in alphabetical order",
    fixable: true,
    defaultSeverity: "off",
  },
  create(context) {
    const { document } = context;
    const root = document.root;
    const services = document.getServicesMap();
    if (!services || root?.tag === "!reset" || services.tag === "!reset")
      return;

    for (const pair of services.items) {
      const value = pair.value;
      if (!isMap(value) || value.tag === "!reset") continue;
      const name = document.pairKeyName(pair);
      if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
      // Order is a property of the text written here, not inherited data.
      const dependencies = value.get("depends_on", true);
      if (
        (!isMap(dependencies) && !isSeq(dependencies)) ||
        dependencies.tag === "!reset"
      )
        continue;
      // An anchored sequence can be reused where item order is meaningful.
      const canFix =
        isMap(dependencies) ||
        ![
          root?.anchor,
          services.anchor,
          value.anchor,
          dependencies.anchor,
        ].some(Boolean);

      reportAlphabeticalOrder(
        context,
        dependencies,
        (actual, expected) =>
          `Service "${name}": dependency "${actual}" is out of alphabetical order (expected "${expected}" here)`,
        canFix,
      );
    }
  },
};
