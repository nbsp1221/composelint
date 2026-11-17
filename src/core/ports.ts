import { isIPv6 } from "node:net";

export interface PublishedPort {
  label: string;
  target: string;
  hostIp?: string;
  published?: string;
  protocol: string;
}

function splitPortBinding(
  label: string,
): { parts: string[]; protocol: string } | null {
  if (!label.includes("${")) {
    const slash = label.lastIndexOf("/");
    return slash === -1
      ? { parts: label.split(":"), protocol: "tcp" }
      : {
          parts: label.slice(0, slash).split(":"),
          protocol: label.slice(slash + 1).toLowerCase(),
        };
  }
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < label.length; index++) {
    const character = label[index];
    if (character === "$" && label[index + 1] === "{") {
      depth++;
      index++;
    } else if (depth > 0) {
      if (character === "}") depth--;
    } else if (character === ":") {
      parts.push(label.slice(start, index));
      start = index + 1;
    } else if (character === "/") {
      parts.push(label.slice(start, index));
      return { parts, protocol: label.slice(index + 1).toLowerCase() };
    }
  }
  if (depth !== 0) return null;
  parts.push(label.slice(start));
  return { parts, protocol: "tcp" };
}

function parseShortPort(label: string): PublishedPort | null {
  const binding = splitPortBinding(label);
  if (!binding) return null;
  const { parts, protocol } = binding;
  const target = parts.pop();
  if (!target || !protocol) return null;

  const published = parts.pop() || undefined;
  const address = parts.join(":");
  if (label.startsWith("[") && !address.endsWith("]")) return null;
  const hostIp = normalizeHostIp(address.replace(/^\[(.*)\]$/, "$1"));
  return { label, target, hostIp, published, protocol };
}

function normalizeHostIp(address: string): string | undefined {
  if (/^[0:]+(?:\.0\.0\.0)?$/.test(address) && isIPv6(address)) return "::";
  return address || undefined;
}

export function parsePublishedPort(entry: unknown): PublishedPort | null {
  if (typeof entry === "string" || typeof entry === "number") {
    return parseShortPort(String(entry).trim());
  }

  if (typeof entry !== "object" || entry === null) return null;
  const { target, published, host_ip, protocol } = entry as Record<
    string,
    unknown
  >;
  if (typeof target !== "number" && typeof target !== "string") return null;
  const hostPort =
    typeof published === "string" || typeof published === "number"
      ? String(published) || undefined
      : undefined;
  return {
    label: hostPort ?? String(target),
    target: String(target),
    hostIp: typeof host_ip === "string" ? normalizeHostIp(host_ip) : undefined,
    published: hostPort,
    protocol: typeof protocol === "string" ? protocol.toLowerCase() : "tcp",
  };
}

export function portIdentity(entry: unknown): unknown {
  const port = parsePublishedPort(entry);
  return port
    ? JSON.stringify([
        port.hostIp ?? "0.0.0.0",
        port.target,
        port.published,
        port.protocol,
      ])
    : entry;
}
