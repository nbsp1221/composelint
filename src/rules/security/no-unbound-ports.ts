import { type PublishedPort, parsePublishedPort } from "../../core/ports.js";
import type {
  PublishedPortAllowance,
  Rule,
  RuleContext,
} from "../../core/types.js";
import { reportServiceValue } from "../report.js";

/** Host addresses that mean "every interface". */
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "*"]);

function isAllowed(
  allowances: readonly PublishedPortAllowance[],
  service: string,
  port: PublishedPort,
): boolean {
  if (port.published === undefined || port.published === "0") return false;
  const key = `${port.published}/${port.protocol}`.toLowerCase();
  return allowances.some(
    (allowance) =>
      allowance.service === service && allowance.published.includes(key),
  );
}

/**
 * A published port with no host address, or one bound to a wildcard address,
 * is reachable on every interface of the host.
 */
export const noUnboundPorts: Rule = {
  meta: {
    name: "no-unbound-ports",
    category: "security",
    description: "Published ports should be bound to a specific interface",
    fixable: false,
    defaultSeverity: "warn",
    options: { allow: "published-port-allowances" },
  },
  create(context: RuleContext) {
    const document = context.document;
    const allowances =
      (context.options.allow as PublishedPortAllowance[] | undefined) ?? [];

    for (const name of document.getMergedServiceNames()) {
      const ports = document.getMergedServiceValue(name, "ports");
      if (!Array.isArray(ports)) continue;

      ports.forEach((entry, index) => {
        const port = parsePublishedPort(entry);
        if (!port) return;
        if (port.hostIp !== undefined && !WILDCARD_HOSTS.has(port.hostIp)) {
          return;
        }
        if (isAllowed(allowances, name, port)) return;

        const subject =
          port.published === undefined || port.published === "0"
            ? `container port "${port.target}" gets a dynamically assigned host port`
            : `port "${port.label}" is published`;
        reportServiceValue(
          context,
          name,
          ["ports", index],
          `Service "${name}": ${subject} on all interfaces (${port.hostIp === "::" ? "::" : "0.0.0.0"})`,
        );
      });
    }
  },
};
