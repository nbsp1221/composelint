import { isIP } from "node:net";
import { type CST, isMap, isNode, isScalar, type YAMLSeq } from "yaml";
import { parsePublishedPort } from "../../core/ports.js";
import { reorderEntries } from "../../core/text-edit.js";
import type { Rule } from "../../core/types.js";
import { localPortLists } from "./local-port-lists.js";

const FIXED_PORT = /^[1-9][0-9]{0,4}$/;
const SHORT_BINDING =
  /^(?:(?:[0-9.]+|\[[0-9A-Fa-f:.]+\]):)?[0-9]+:[0-9]+(?:\/[A-Za-z]+)?$/;

function publishedNumber(node: unknown): number | undefined {
  if ((!isScalar(node) && !isMap(node)) || node.tag) return;
  let entry: unknown;
  if (isScalar(node)) {
    if (typeof node.value !== "string" || !SHORT_BINDING.test(node.value))
      return;
    entry = node.value;
  } else {
    const binding: Record<string, unknown> = {};
    for (const { key, value } of node.items) {
      if (
        !isScalar(key) ||
        typeof key.value !== "string" ||
        !isScalar(value) ||
        value.tag
      )
        return;
      if (["target", "published", "host_ip", "protocol"].includes(key.value))
        binding[key.value] = value.value;
    }
    if (binding.host_ip !== undefined && typeof binding.host_ip !== "string")
      return;
    if (binding.protocol !== undefined && typeof binding.protocol !== "string")
      return;
    entry = binding;
  }
  const port = parsePublishedPort(entry);
  if (
    !port?.published ||
    !FIXED_PORT.test(port.published) ||
    !FIXED_PORT.test(port.target) ||
    Number(port.published) > 65535 ||
    Number(port.target) > 65535 ||
    (port.hostIp && !isIP(port.hostIp)) ||
    !["tcp", "udp", "sctp"].includes(port.protocol)
  )
    return;
  return Number(port.published);
}

/** A simple interpolated published port can be compared as written. */
function sortKey(node: unknown): string | undefined {
  const number = publishedNumber(node);
  if (number !== undefined) return String(number);
  if (!isScalar(node) || node.tag || typeof node.value !== "string") return;
  return /^(\$\{[A-Za-z_][A-Za-z0-9_]*\}):[1-9][0-9]{0,4}(?:\/(?:tcp|udp|sctp))?$/.exec(
    node.value,
  )?.[1];
}

export const servicePortsAlphabeticalOrder: Rule = {
  meta: {
    name: "service-ports-alphabetical-order",
    category: "style",
    description: "Fixed published ports should be in ascending numeric order",
    fixable: true,
    defaultSeverity: "off",
  },
  create(context) {
    for (const { service, list } of localPortLists(context.document, [
      "ports",
    ])) {
      let previous: string | undefined;
      for (const item of list.items) {
        const port = sortKey(item);
        if (
          isNode(item) &&
          previous !== undefined &&
          port !== undefined &&
          previous.localeCompare(port, "en", { numeric: true }) > 0
        ) {
          context.report({
            node: item,
            message: `Service "${service}": published port ${port} should appear before ${previous}`,
            fix: () => {
              // Reorder only a complete list of distinct, literal short bindings.
              // Comments, anchors and directives need a richer preservation model.
              if (
                list.flow ||
                list.anchor ||
                /[#&*]/.test(context.document.source)
              )
                return null;
              const values = list.items.map(publishedNumber);
              if (
                values.some((value) => value === undefined) ||
                new Set(values).size !== values.length
              )
                return null;
              const token = (list as YAMLSeq & { srcToken?: CST.Token })
                .srcToken;
              if (token?.type !== "block-seq") return null;
              const ranges = list.items.map((node, index) => {
                if (!isScalar(node) || node.tag || node.anchor || !node.range)
                  return null;
                const dash = token.items[index]?.start.find(
                  ({ type }) => type === "seq-item-ind",
                );
                return dash
                  ? { keyStart: dash.offset, valueEnd: node.range[2] }
                  : null;
              });
              if (ranges.some((range) => range === null)) return null;
              const order = values
                .map((value, index) => ({ value: value as number, index }))
                .sort((a, b) => a.value - b.value)
                .map(({ index }) => index);
              return reorderEntries(
                context.document.source,
                ranges as { keyStart: number; valueEnd: number }[],
                order,
                {
                  newline: context.document.source.match(/\r?\n/)?.[0],
                },
              );
            },
          });
          break;
        }
        previous = port;
      }
    }
  },
};
