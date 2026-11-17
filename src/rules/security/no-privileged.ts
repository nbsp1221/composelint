import { parseComposeBoolean } from "../../core/compose-boolean.js";
import type { Rule, RuleContext } from "../../core/types.js";
import { reportServiceValue } from "../report.js";

export const noPrivileged: Rule = {
  meta: {
    name: "no-privileged",
    category: "security",
    description: "Services should not run in privileged mode",
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context: RuleContext) {
    const document = context.document;

    for (const name of document.getMergedServiceNames()) {
      if (
        parseComposeBoolean(
          document.getMergedServiceValue(name, "privileged"),
        ) !== true
      ) {
        continue;
      }

      reportServiceValue(
        context,
        name,
        ["privileged"],
        `Service "${name}": privileged mode grants full access to the host`,
      );
    }
  },
};
