import { isIP } from "node:net";
import { parsePublishedPort } from "../../core/ports.js";
import type { Rule } from "../../core/types.js";
import { reportServiceValue } from "../report.js";
import { collisionServices } from "./collision-services.js";

const PROTOCOLS = new Set(["tcp", "udp", "sctp"]);

function portInterval(value: string | undefined, short: boolean) {
  const match = /^(\d+)(?:-(\d+))?$/.exec(value ?? "");
  if (!match || match[0] !== value || (!short && match[2] !== undefined)) {
    return null;
  }
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return start <= end && end <= 65535 ? { start, end } : null;
}

function staticBinding(entry: unknown) {
  const short = typeof entry === "string" || typeof entry === "number";
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
  if (!port || !PROTOCOLS.has(port.protocol)) return null;
  const published = portInterval(port.published, short);
  const target = portInterval(port.target, short);
  if (
    !published ||
    !target ||
    target.start === 0 ||
    published.end === 0 ||
    published.end - published.start !== target.end - target.start
  ) {
    return null;
  }
  const start = Math.max(1, published.start);
  const end = published.end;
  const ports = start === end ? String(start) : `${start}-${end}`;
  const host = port.hostIp ?? "0.0.0.0";
  const family = isIP(host);
  if (!family || host.includes("%")) return null;
  const address = family === 6 ? new URL(`http://[${host}]`).hostname : host;
  return {
    key: `${family}/${port.protocol}`,
    start,
    end,
    address,
    wildcard: family === 6 ? "[::]" : "0.0.0.0",
    label: `${address}:${ports}/${port.protocol}`,
  };
}

type StaticBinding = NonNullable<ReturnType<typeof staticBinding>>;
type OwnedBinding = StaticBinding & { service: string };

interface BindingGroup {
  entries: OwnedBinding[];
  ranges: OwnedBinding[];
  singles: Map<number, Map<string, string>>;
}

function overlappingService(binding: StaticBinding, group: BindingGroup) {
  const { start, end, address, wildcard } = binding;
  if (start === end) {
    const owners = group.singles.get(start);
    const exact =
      address === wildcard
        ? owners?.values().next().value
        : (owners?.get(address) ?? owners?.get(wildcard));
    if (exact !== undefined) return exact;
  }
  const candidates = start === end ? group.ranges : group.entries;
  return candidates.find(
    (other) =>
      start <= other.end &&
      other.start <= end &&
      (address === other.address ||
        address === wildcard ||
        other.address === wildcard),
  )?.service;
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
    const bindings = new Map<string, BindingGroup>();
    for (const { name, service } of collisionServices(context.document)) {
      if (!Array.isArray(service.ports) || service.network_mode === "host")
        continue;
      const current: StaticBinding[] = [];
      for (const [index, entry] of service.ports.entries()) {
        const binding = staticBinding(entry);
        if (!binding) continue;
        current.push(binding);

        const group = bindings.get(binding.key);
        if (!group) continue;
        const previous = overlappingService(binding, group);
        if (previous === undefined) continue;
        reportServiceValue(
          context,
          name,
          ["ports", index],
          `Service "${name}": host binding "${binding.label}" may conflict with service "${previous}"`,
        );
      }

      for (const binding of current) {
        const { key, start, end, address } = binding;
        let group = bindings.get(key);
        if (!group) {
          group = { entries: [], ranges: [], singles: new Map() };
          bindings.set(key, group);
        }
        const owned = { ...binding, service: name };
        group.entries.push(owned);
        if (start !== end) {
          group.ranges.push(owned);
          continue;
        }
        let owners = group.singles.get(start);
        if (!owners) {
          owners = new Map();
          group.singles.set(start, owners);
        }
        if (!owners.has(address)) owners.set(address, name);
      }
    }
  },
};
