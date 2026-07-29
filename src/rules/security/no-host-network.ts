import type { Rule, RuleContext } from "../../core/types.js";
import { reportServiceValue } from "../report.js";

export const noHostNetwork: Rule = {
  meta: {
    name: "no-host-network",
    category: "security",
    description: "Services should not use host network mode",
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context: RuleContext) {
    const document = context.document;

    for (const name of document.getMergedServiceNames()) {
      if (document.getMergedServiceValue(name, "network_mode") !== "host") {
        continue;
      }

      reportServiceValue(
        context,
        name,
        ["network_mode"],
        `Service "${name}": host network mode bypasses network isolation`,
      );
    }
  },
};
