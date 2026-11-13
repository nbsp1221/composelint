import { isIP } from "node:net";
import { isMap, isNode, isScalar } from "yaml";
import { parsePublishedPort } from "../../core/ports.js";
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

export const servicePortsAlphabeticalOrder: Rule = {
  meta: {
    name: "service-ports-alphabetical-order",
    category: "style",
    description: "Fixed published ports should be in ascending numeric order",
    fixable: false,
    defaultSeverity: "off",
  },
  create(context) {
    for (const { service, list } of localPortLists(context.document, [
      "ports",
    ])) {
      let previous: number | undefined;
      for (const item of list.items) {
        const port = publishedNumber(item);
        if (
          isNode(item) &&
          previous !== undefined &&
          port !== undefined &&
          previous > port
        ) {
          context.report({
            node: item,
            message: `Service "${service}": published port ${port} should appear before ${previous}`,
          });
          break;
        }
        previous = port;
      }
    }
  },
};
