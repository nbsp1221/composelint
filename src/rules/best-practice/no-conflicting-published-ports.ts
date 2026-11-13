import { isIP } from "node:net";
import { parsePublishedPort } from "../../core/ports.js";
import type { Rule } from "../../core/types.js";
import { reportServiceValue } from "../report.js";
import { collisionServices } from "./collision-services.js";

const PROTOCOLS = new Set(["tcp", "udp", "sctp"]);

function isFixedPort(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^\d+$/.test(value) &&
    Number(value) >= 1 &&
    Number(value) <= 65535
  );
}

function staticBinding(entry: unknown) {
  if (typeof entry === "string" && entry.includes("$")) return null;
  if (typeof entry === "object" && entry !== null) {
    const { host_ip, protocol } = entry as Record<string, unknown>;
    if (
      (host_ip !== undefined && typeof host_ip !== "string") ||
      (protocol !== undefined && typeof protocol !== "string")
    ) {
      return null;
    }
  }

  const port = parsePublishedPort(entry);
  if (
    !port ||
    !isFixedPort(port.published) ||
    !isFixedPort(port.target) ||
    !PROTOCOLS.has(port.protocol)
  ) {
    return null;
  }
  const host = port.hostIp ?? "0.0.0.0";
  const family = isIP(host);
  if (!family || host.includes("%")) return null;
  const address = family === 6 ? new URL(`http://[${host}]`).hostname : host;
  return {
    key: `${family}:${Number(port.published)}/${port.protocol}`,
    address,
    wildcard: family === 6 ? "[::]" : "0.0.0.0",
    label: `${address}:${Number(port.published)}/${port.protocol}`,
  };
}

export const noConflictingPublishedPorts: Rule = {
  meta: {
    name: "no-conflicting-published-ports",
    category: "best-practice",
    description: "Services should avoid conflicting static host-port bindings",
    requiresFullProject: true,
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context) {
    const bindings = new Map<string, Map<string, string>>();
    for (const { name, service } of collisionServices(context.document)) {
      if (!Array.isArray(service.ports) || service.network_mode === "host")
        continue;
      const current: Array<NonNullable<ReturnType<typeof staticBinding>>> = [];
      for (const [index, entry] of service.ports.entries()) {
        const binding = staticBinding(entry);
        if (!binding) continue;
        current.push(binding);

        const { key, address, wildcard, label } = binding;
        const owners = bindings.get(key);
        if (!owners) continue;
        const previous =
          address === wildcard
            ? owners.values().next().value
            : (owners.get(address) ?? owners.get(wildcard));
        if (previous === undefined) continue;
        reportServiceValue(
          context,
          name,
          ["ports", index],
          `Service "${name}": host binding "${label}" may conflict with service "${previous}"`,
        );
      }

      for (const { key, address } of current) {
        let owners = bindings.get(key);
        if (!owners) {
          owners = new Map();
          bindings.set(key, owners);
        }
        if (!owners.has(address)) owners.set(address, name);
      }
    }
  },
};
