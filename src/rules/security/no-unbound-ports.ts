import type { Rule, RuleContext } from "../../core/types.js";
import { reportServiceValue } from "../report.js";

/** Host addresses that mean "every interface". */
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "*"]);

interface PublishedPort {
  /** How the port is written, for the message. */
  label: string;
  /** The host address the port binds to, or undefined when none is given. */
  hostIp: string | undefined;
}

/**
 * Reads the short syntax: `[HOST_IP:][HOST_PORT:]CONTAINER_PORT[/PROTOCOL]`.
 * Returns null when nothing is published on the host.
 */
function parseShortSyntax(raw: string): PublishedPort | null {
  const value = raw.trim();
  const withoutProtocol = value.split("/")[0];

  // An IPv6 address is bracketed: [::1]:8080:80
  if (withoutProtocol.startsWith("[")) {
    const closing = withoutProtocol.indexOf("]");
    if (closing === -1) return null;
    const hostIp = withoutProtocol.slice(1, closing);
    const rest = withoutProtocol.slice(closing + 1).replace(/^:/, "");
    // Without a host port there is nothing published on the host.
    if (!rest.includes(":")) return null;
    return { label: value, hostIp };
  }

  const parts = withoutProtocol.split(":");
  if (parts.length === 1) return null; // container port only
  if (parts.length === 2) return { label: value, hostIp: undefined };
  return { label: value, hostIp: parts.slice(0, -2).join(":") };
}

/** Reads the long syntax: `{ target, published, host_ip, ... }`. */
function parseLongSyntax(entry: Record<string, unknown>): PublishedPort | null {
  const published = entry.published;
  if (published === undefined || published === null) return null;

  const hostIp = entry.host_ip;
  return {
    label: String(published),
    hostIp: typeof hostIp === "string" ? hostIp : undefined,
  };
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
  },
  create(context: RuleContext) {
    const document = context.document;

    for (const name of document.getMergedServiceNames()) {
      const ports = document.getMergedServiceValue(name, "ports");
      if (!Array.isArray(ports)) continue;

      ports.forEach((entry, index) => {
        let port: PublishedPort | null = null;
        if (typeof entry === "string") {
          port = parseShortSyntax(entry);
        } else if (typeof entry === "object" && entry !== null) {
          port = parseLongSyntax(entry as Record<string, unknown>);
        }

        if (!port) return;
        if (port.hostIp !== undefined && !WILDCARD_HOSTS.has(port.hostIp)) {
          return;
        }

        reportServiceValue(
          context,
          name,
          ["ports", index],
          `Service "${name}": port "${port.label}" is published on all interfaces (0.0.0.0)`,
        );
      });
    }
  },
};
