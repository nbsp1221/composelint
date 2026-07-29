import type { Rule, RuleContext } from "../../core/types.js";
import { reportServiceValue } from "../report.js";

export const noCapAddAll: Rule = {
  meta: {
    name: "no-cap-add-all",
    category: "security",
    description: "Services should not add ALL capabilities",
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context: RuleContext) {
    const document = context.document;

    for (const name of document.getMergedServiceNames()) {
      const capabilities = document.getMergedServiceValue(name, "cap_add");
      if (!Array.isArray(capabilities)) continue;

      capabilities.forEach((capability, index) => {
        if (String(capability).toUpperCase() !== "ALL") return;

        reportServiceValue(
          context,
          name,
          ["cap_add", index],
          `Service "${name}": cap_add includes ALL, which is equivalent to privileged mode`,
        );
      });
    }
  },
};
