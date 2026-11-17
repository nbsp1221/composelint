import type { Rule } from "../../core/types.js";
import { reportAlphabeticalOrder } from "./alphabetical-order.js";

export const servicesAlphabeticalOrder: Rule = {
  meta: {
    name: "services-alphabetical-order",
    category: "style",
    description: "Service names should be in alphabetical order",
    fixable: true,
    defaultSeverity: "off",
  },
  create(context) {
    const { document } = context;
    const services = document.getServicesMap();
    if (
      !services ||
      services.tag === "!reset" ||
      document.root?.tag === "!reset"
    )
      return;

    reportAlphabeticalOrder(
      context,
      services,
      (actual, expected) =>
        `Service "${actual}": out of alphabetical order (expected "${expected}" here)`,
    );
  },
};
