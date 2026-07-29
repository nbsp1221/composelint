import { deleteEntryLines } from "../../core/text-edit.js";
import type { Rule, RuleContext } from "../../core/types.js";

export const noVersionField: Rule = {
  meta: {
    name: "no-version-field",
    category: "style",
    description:
      'The top-level "version" field is obsolete and should be removed',
    fixable: true,
    defaultSeverity: "error",
  },
  create(context: RuleContext) {
    const root = context.document.root;
    if (!root) return;

    const versionPair = root.items.find(
      (p) => context.document.pairKeyName(p) === "version",
    );
    if (!versionPair) return;

    const keyRange = (
      versionPair.key as { range?: [number, number, number] } | null
    )?.range;
    const valueRange = (
      versionPair.value as { range?: [number, number, number] } | null
    )?.range;
    const keyStart = keyRange?.[0];
    const valueEnd = valueRange?.[1] ?? keyRange?.[1];

    context.report({
      message:
        'Top-level "version" field is obsolete in modern Compose and should be removed',
      node: versionPair.key as { range?: [number, number, number] },
      fix: () => {
        if (root.flow) return null;
        if (keyStart === undefined || valueEnd === undefined) return null;
        return deleteEntryLines(context.document.source, {
          keyStart,
          valueEnd,
        });
      },
    });
  },
};
