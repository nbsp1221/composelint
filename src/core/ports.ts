export interface PublishedPort {
  label: string;
  target: string;
  hostIp?: string;
  published?: string;
  protocol: string;
}

export function parsePublishedPort(entry: unknown): PublishedPort | null {
  if (typeof entry === "string" || typeof entry === "number") {
    const label = String(entry).trim();
    const slash = label.lastIndexOf("/");
    const binding = slash === -1 ? label : label.slice(0, slash);
    const protocol =
      slash === -1 ? "tcp" : label.slice(slash + 1).toLowerCase();
    const parts = binding.split(":");
    const target = parts.pop();
    if (!target) return null;

    const published = parts.pop() || undefined;
    const address = parts.join(":");
    if (binding.startsWith("[") && !address.endsWith("]")) return null;
    const hostIp = address.replace(/^\[(.*)\]$/, "$1") || undefined;
    return { label, target, hostIp, published, protocol };
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
    hostIp: typeof host_ip === "string" ? host_ip : undefined,
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
