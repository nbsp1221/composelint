import { isScalar, parseDocument, type Scalar } from "yaml";
import type { Rule, TextEdit } from "../../core/types.js";
import { localPortLists } from "./local-port-lists.js";

const PORT_PART = "[0-9]+(?:-[0-9]+)?";
const PROTOCOL = "(?:/[A-Za-z][A-Za-z0-9+.-]*)?";
const EXPOSE = new RegExp(`^${PORT_PART}${PROTOCOL}$`);
const PORTS = new RegExp(
  `^(?:(?:(?:[0-9.]+|\\[[0-9A-Fa-f:.]+\\]):)?${PORT_PART}:)?${PORT_PART}${PROTOCOL}$`,
);
// Restrict interpolation edits to a single plain token that needs no escaping.
const INTERPOLATED = /^[0-9A-Za-z.$_{}:/?+%[\]-]+$/;

function quoteFix(
  node: Scalar,
  raw: string,
  start: number,
  end: number,
): TextEdit[] | null {
  if (node.tag || typeof node.value !== "string" || node.value !== raw)
    return null;
  const text = `"${raw}"`;
  const parsed = parseDocument(text);
  if (
    parsed.errors.length ||
    !isScalar(parsed.contents) ||
    parsed.contents.value !== node.value
  )
    return null;
  return [{ start, end, text }];
}

export const requireQuotesInPorts: Rule = {
  meta: {
    name: "require-quotes-in-ports",
    category: "style",
    description: "Use quotes for short ports and expose entries",
    fixable: true,
    defaultSeverity: "off",
  },
  create(context) {
    const { document } = context;
    for (const { service, field, list } of localPortLists(document, [
      "ports",
      "expose",
    ])) {
      for (const item of list.items) {
        if (
          !isScalar(item) ||
          item.type !== "PLAIN" ||
          !item.range ||
          item.tag === "!reset"
        )
          continue;
        const [start, end] = item.range;
        const raw = document.source.slice(start, end);
        const literal = (field === "ports" ? PORTS : EXPOSE).test(raw);
        const interpolation = raw.includes("${") && INTERPOLATED.test(raw);
        if (!literal && !interpolation) continue;
        context.report({
          node: item,
          message: `Service "${service}": quote short ${field} entry "${raw}"`,
          fix: () => quoteFix(item, raw, start, end),
        });
      }
    }
  },
};
