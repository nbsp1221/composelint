import type { Rule, RuleContext } from "../../core/types.js";

export const requireHealthcheck: Rule = {
  meta: {
    name: "require-healthcheck",
    category: "best-practice",
    description: "Long-running services should define a healthcheck",
    requiresFullProject: true,
    options: { exclude: "string[]" },
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context: RuleContext) {
    const document = context.document;
    const exclude = (context.options.exclude as string[] | undefined) ?? [];

    for (const name of document.getMergedServiceNames()) {
      if (exclude.includes(name)) continue;
      // Part of this service lives in a file we do not read.
      if (document.hasExternalExtends(name)) continue;
      // A `provider` service delegates to an external binary instead of
      // starting a container, so there is nothing for Compose to health-check.
      if (document.getMergedServiceKeys(name).includes("provider")) continue;
      // Inherited healthchecks count, so the merged keys are what matter.
      if (document.getMergedServiceKeys(name).includes("healthcheck")) continue;

      // Absence has no node of its own; point at the service itself.
      const target = document.getServiceReportTarget(name);
      context.report({
        message: `Service "${name}": no healthcheck defined`,
        node: target.node,
      });
    }
  },
};
