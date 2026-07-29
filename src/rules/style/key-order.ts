/**
 * The canonical key order for a service, expressed as logical groups.
 *
 * Two ideas from prior art shape this list:
 *
 * - `sort-package-json` enumerates *every* recognised key so nothing is
 *   silently pushed to the end. Every key in the Compose Specification appears
 *   here exactly once, and a test enforces that against the vendored schema.
 * - dclint groups Compose keys by purpose and documents the rationale, which is
 *   what makes an ordering opinion reviewable rather than arbitrary.
 *
 * Keys the specification does not define (and future keys not yet placed here)
 * keep their relative order after the known keys.
 */
export const SERVICE_KEY_GROUPS = {
  /** What this service inherits from, before anything it defines itself. */
  inheritance: ["extends"],

  /** What the service is and where its image comes from. */
  identity: [
    "image",
    "build",
    "provider",
    "platform",
    "pull_policy",
    "pull_refresh_after",
    "container_name",
  ],

  /** When the service runs and what it needs first. */
  activation: ["profiles", "depends_on", "links", "external_links"],

  /** How the container process is started and stopped. */
  execution: [
    "command",
    "entrypoint",
    "working_dir",
    "user",
    "group_add",
    "init",
    "tty",
    "stdin_open",
    "attach",
    "restart",
    "stop_signal",
    "stop_grace_period",
    "pre_start",
    "post_start",
    "pre_stop",
  ],

  /** Values and resources injected into the service. */
  configuration: [
    "env_file",
    "environment",
    "label_file",
    "labels",
    "annotations",
    "configs",
    "secrets",
    "credential_spec",
    "models",
  ],

  /** How the service is reachable and how it resolves names. */
  networking: [
    "ports",
    "expose",
    "networks",
    "network_mode",
    "hostname",
    "domainname",
    "extra_hosts",
    "dns",
    "dns_opt",
    "dns_search",
    "mac_address",
  ],

  /** Where the service keeps data and which devices it can reach. */
  storage: [
    "volumes",
    "volumes_from",
    "tmpfs",
    "shm_size",
    "storage_opt",
    "devices",
    "device_cgroup_rules",
  ],

  /** How the service is observed. */
  observability: ["healthcheck", "logging"],

  /** How much of the host the service may consume, and how it is scheduled. */
  resources: [
    "deploy",
    "scale",
    "gpus",
    "cpus",
    "cpu_count",
    "cpu_percent",
    "cpu_shares",
    "cpu_period",
    "cpu_quota",
    "cpu_rt_period",
    "cpu_rt_runtime",
    "cpuset",
    "mem_limit",
    "mem_reservation",
    "mem_swappiness",
    "memswap_limit",
    "oom_kill_disable",
    "oom_score_adj",
    "pids_limit",
    "blkio_config",
    "ulimits",
    "cgroup",
    "cgroup_parent",
  ],

  /** Privileges and isolation — grouped so a review can scan them together. */
  security: [
    "privileged",
    "read_only",
    "cap_add",
    "cap_drop",
    "security_opt",
    "sysctls",
    "userns_mode",
    "use_api_socket",
    "ipc",
    "pid",
    "uts",
    "isolation",
    "runtime",
  ],

  /** Development-time behaviour, last because it does not affect production. */
  development: ["develop"],
} as const satisfies Record<string, readonly string[]>;

const SERVICE_KEY_GROUP_NAMES = Object.keys(SERVICE_KEY_GROUPS) as Array<
  keyof typeof SERVICE_KEY_GROUPS
>;

export const DEFAULT_SERVICE_KEY_ORDER: string[] =
  SERVICE_KEY_GROUP_NAMES.flatMap((name) => [...SERVICE_KEY_GROUPS[name]]);

/**
 * Top-level key order. `services` first among the content blocks, then the
 * resources they reference in the order the Compose reference documents them
 * (networks, volumes, configs, secrets), which is also dclint's order.
 *
 * `version` is absent on purpose: it is obsolete (no-version-field asks for its removal),
 * so ordering it would mean giving advice about a key we want gone. It is
 * treated as position-independent instead.
 */
export const DEFAULT_TOP_LEVEL_ORDER: string[] = [
  "name",
  "include",
  "services",
  "networks",
  "volumes",
  "configs",
  "secrets",
  "models",
];
