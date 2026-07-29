import type { Rule, RuleContext } from "../../core/types.js";
import { reportServiceValue } from "../report.js";

/**
 * Compose accepts these flags written as strings, and YAML keeps `"true"` as
 * text, so a quoted value must count as enabled.
 */
function isEnabled(value: unknown): boolean {
  if (value === true) return true;
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

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
      if (!isEnabled(document.getMergedServiceValue(name, "privileged"))) {
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
