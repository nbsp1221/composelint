import type { Rule, RuleContext } from "../../core/types.js";

export const requireName: Rule = {
  meta: {
    name: "require-name",
    category: "best-practice",
    description: "Compose file should include a top-level name field",
    requiresFullProject: true,
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context: RuleContext) {
    const root = context.document.root;
    if (!root) return;

    const name = (context.document.toJS() as { name?: unknown } | null)?.name;
    const missing =
      name === undefined ||
      name === null ||
      (typeof name === "string" && name.trim() === "");

    if (missing) {
      context.report({
        message:
          'Missing top-level "name" field — set it for stable project identifiers across directories and CI',
        node: root as { range?: [number, number, number] },
      });
    }
  },
};
