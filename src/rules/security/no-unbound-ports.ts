import { isIP } from "node:net";
import type {
  PublishedPortAllowance,
  Rule,
  RuleContext,
} from "../../core/types.js";
import { reportServiceValue } from "../report.js";

/** Host addresses that mean "every interface". */
const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "::", "*"]);

interface PublishedPort {
  /** How the port is written, for the message. */
  label: string;
  /** The host address the port binds to, or undefined when none is given. */
  hostIp: string | undefined;
  /** Published host port or range; absent when Docker assigns it at runtime. */
  published: string | undefined;
  protocol: string;
}

/**
 * Reads the short syntax: `[HOST_IP:][HOST_PORT:]CONTAINER_PORT[/PROTOCOL]`.
 * Returns null when nothing is published on the host.
 */
function parseShortSyntax(raw: string): PublishedPort | null {
  const value = raw.trim();
  const slash = value.lastIndexOf("/");
  const withoutProtocol = slash === -1 ? value : value.slice(0, slash);
  const protocol = slash === -1 ? "tcp" : value.slice(slash + 1).toLowerCase();

  // An IPv6 address is bracketed: [::1]:8080:80
  if (withoutProtocol.startsWith("[")) {
    const closing = withoutProtocol.indexOf("]");
    if (closing === -1) return null;
    const hostIp = withoutProtocol.slice(1, closing);
    const rest = withoutProtocol.slice(closing + 1).replace(/^:/, "");
    // An address plus only the container port still asks Docker to assign a
    // host port, but the explicit address determines which interface it uses.
    if (!rest.includes(":")) {
      return { label: value, hostIp, published: undefined, protocol };
    }
    return {
      label: value,
      hostIp,
      published: rest.split(":")[0],
      protocol,
    };
  }

  const parts = withoutProtocol.split(":");
  // With only the container port, Docker assigns a host port at runtime and
  // still binds it to every interface by default.
  if (parts.length === 1) {
    return {
      label: value,
      hostIp: undefined,
      published: undefined,
      protocol,
    };
  }
  if (parts.length === 2) {
    if (isIP(parts[0]) !== 0 || WILDCARD_HOSTS.has(parts[0])) {
      return {
        label: value,
        hostIp: parts[0],
        published: undefined,
        protocol,
      };
    }
    return {
      label: value,
      hostIp: undefined,
      published: parts[0],
      protocol,
    };
  }
  return {
    label: value,
    hostIp: parts.slice(0, -2).join(":"),
    published: parts.at(-2),
    protocol,
  };
}

/** Reads the long syntax: `{ target, published, host_ip, ... }`. */
function parseLongSyntax(entry: Record<string, unknown>): PublishedPort | null {
  const published = entry.published;
  if (published === undefined || published === null) return null;

  const hostIp = entry.host_ip;
  return {
    label: String(published),
    hostIp: typeof hostIp === "string" ? hostIp : undefined,
    published: String(published),
    protocol:
      typeof entry.protocol === "string" ? entry.protocol.toLowerCase() : "tcp",
  };
}

function isAllowed(
  allowances: readonly PublishedPortAllowance[],
  service: string,
  port: PublishedPort,
): boolean {
  if (port.published === undefined) return false;
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
        let port: PublishedPort | null = null;
        if (typeof entry === "string" || typeof entry === "number") {
          port = parseShortSyntax(String(entry));
        } else if (typeof entry === "object" && entry !== null) {
          port = parseLongSyntax(entry as Record<string, unknown>);
        }

        if (!port) return;
        if (port.hostIp !== undefined && !WILDCARD_HOSTS.has(port.hostIp)) {
          return;
        }
        if (isAllowed(allowances, name, port)) return;

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
