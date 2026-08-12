import { cosmiconfig } from "cosmiconfig";
import type {
  PublishedPortAllowance,
  ResolvedConfig,
  RuleConfig,
  Severity,
} from "../core/types.js";
import { allRules } from "../rules/index.js";
import { DEFAULT_EXCLUDE, DEFAULT_PARTIALS } from "./defaults.js";
import {
  DEFAULT_PRESET,
  type PresetName,
  presetNames,
  presets,
} from "./presets.js";

/** Severity as it may be written in a configuration file. */
export type SeverityInput = Severity | 0 | 1 | 2;

/**
 * A rule override. All of the following are equivalent:
 *
 * ```json
 * { "no-unbound-ports": "error" }
 * { "no-unbound-ports": 2 }
 * { "no-unbound-ports": ["error"] }
 * { "no-unbound-ports": { "severity": "error" } }
 * ```
 *
 * Options are passed as a second element or an `options` key:
 *
 * ```json
 * { "no-unbound-ports": ["error", { "allow": ["127.0.0.1"] }] }
 * ```
 */
export type RuleEntry =
  | SeverityInput
  | [SeverityInput, Record<string, unknown>?]
  | { severity: SeverityInput; options?: Record<string, unknown> };

export interface RawConfig {
  preset?: PresetName;
  rules?: Record<string, RuleEntry>;
  exclude?: string[];
  /**
   * Files that only carry part of a project, such as `include:` fragments.
   * Override files are recognised by convention without configuration.
   */
  partials?: string[];
}

const MODULE_NAME = "composelint";

const NUMERIC_SEVERITY: Record<number, Severity> = {
  0: "off",
  1: "warn",
  2: "error",
};

/** Configuration keys this linter understands; anything else is a typo. */
const KNOWN_CONFIG_KEYS = new Set(["preset", "rules", "exclude", "partials"]);

const RULES_BY_NAME = new Map(allRules.map((rule) => [rule.meta.name, rule]));

export async function loadConfig(
  configPath?: string,
): Promise<{ config: RawConfig; filepath?: string }> {
  const explorer = cosmiconfig(MODULE_NAME, {
    // Search upwards until the project root (a directory with package.json or
    // .git), so running the CLI from a subdirectory uses the same config.
    searchStrategy: "project",
    searchPlaces: [
      `.${MODULE_NAME}rc`,
      `.${MODULE_NAME}rc.json`,
      `.${MODULE_NAME}rc.yml`,
      `.${MODULE_NAME}rc.yaml`,
      `${MODULE_NAME}.config.js`,
      `${MODULE_NAME}.config.mjs`,
      `${MODULE_NAME}.config.ts`,
      `package.json`,
    ],
  });

  const result = configPath
    ? await explorer.load(configPath)
    : await explorer.search();

  if (!result || result.isEmpty) {
    return { config: {} };
  }

  return { config: result.config as RawConfig, filepath: result.filepath };
}

function normalizeSeverity(value: unknown): Severity | null {
  if (value === "error" || value === "warn" || value === "off") return value;
  if (typeof value === "number" && value in NUMERIC_SEVERITY) {
    return NUMERIC_SEVERITY[value];
  }
  return null;
}

interface NormalizedEntry {
  severity: Severity;
  options?: Record<string, unknown>;
}

function normalizeEntry(entry: unknown): NormalizedEntry | string {
  if (typeof entry === "string" || typeof entry === "number") {
    const severity = normalizeSeverity(entry);
    return severity
      ? { severity }
      : `invalid severity ${JSON.stringify(entry)}`;
  }

  if (Array.isArray(entry)) {
    if (entry.length === 0) return "empty array";
    const severity = normalizeSeverity(entry[0]);
    if (!severity) return `invalid severity ${JSON.stringify(entry[0])}`;
    const options = entry[1];
    if (options !== undefined && !isPlainObject(options)) {
      return "rule options must be an object";
    }
    return { severity, options };
  }

  if (isPlainObject(entry)) {
    const severity = normalizeSeverity(entry.severity);
    if (!severity) {
      return `invalid severity ${JSON.stringify(entry.severity)}`;
    }
    const options = entry.options;
    if (options !== undefined && !isPlainObject(options)) {
      return "rule options must be an object";
    }
    return { severity, options };
  }

  return `invalid rule configuration ${JSON.stringify(entry)}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveConfig(
  raw: RawConfig,
  cliPreset?: PresetName,
): ResolvedConfig {
  const warnings: string[] = [];

  // The file contents are untrusted: a config that is not a mapping would
  // otherwise be applied as an empty one, and the user would never know.
  let config: RawConfig = raw;
  if (!isPlainObject(raw)) {
    warnings.push(
      "Configuration must be a mapping of options — the file was ignored.",
    );
    config = {};
  } else {
    for (const key of Object.keys(raw)) {
      if (!KNOWN_CONFIG_KEYS.has(key)) {
        warnings.push(`Unknown configuration key "${key}" — ignored.`);
      }
    }
  }

  const requestedPreset = cliPreset ?? config.preset ?? DEFAULT_PRESET;
  let presetName: PresetName = DEFAULT_PRESET;
  if (requestedPreset in presets) {
    presetName = requestedPreset as PresetName;
  } else {
    warnings.push(
      `Unknown preset "${requestedPreset}". Valid presets: ${presetNames.join(", ")}. Falling back to "${DEFAULT_PRESET}".`,
    );
  }
  const preset = presets[presetName];

  const rules = new Map<string, RuleConfig>();

  // Every preset covers every rule (enforced by a test), so the preset is the
  // single source of truth for the starting severity.
  for (const rule of allRules) {
    rules.set(rule.meta.name, {
      severity: preset[rule.meta.name],
      options: {},
    });
  }

  const rawRules = config.rules;
  if (rawRules !== undefined && !isPlainObject(rawRules)) {
    warnings.push(
      '"rules" must be a mapping of rule names to severities — ignored.',
    );
  }

  // Apply user overrides on top of the preset.
  for (const [key, entry] of Object.entries(
    isPlainObject(rawRules) ? rawRules : {},
  )) {
    if (!RULES_BY_NAME.has(key)) {
      warnings.push(`Unknown rule "${key}" in configuration — ignored.`);
      continue;
    }

    const normalized = normalizeEntry(entry);
    if (typeof normalized === "string") {
      warnings.push(`Rule "${key}": ${normalized} — ignored.`);
      continue;
    }

    const existing = rules.get(key);
    if (!existing) continue;

    existing.severity = normalized.severity;
    if (normalized.options) {
      existing.options = {
        ...existing.options,
        ...validateOptions(key, normalized.options, warnings),
      };
    }
  }

  return {
    rules,
    exclude: normalizePatterns(
      config.exclude,
      DEFAULT_EXCLUDE,
      "exclude",
      warnings,
    ),
    partials: normalizePatterns(
      config.partials,
      DEFAULT_PARTIALS,
      "partials",
      warnings,
    ),
    warnings,
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** Compose permits platform-specific protocols in addition to TCP and UDP. */
const PUBLISHED_PORT = /^(\d+)(?:-(\d+))?\/([a-z][a-z0-9+.-]*)$/i;

function isValidPublishedPort(value: string): boolean {
  const match = PUBLISHED_PORT.exec(value);
  if (!match) return false;

  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return start >= 1 && end <= 65_535 && start <= end;
}

function validatePublishedPortAllowances(
  ruleName: string,
  option: string,
  value: unknown,
  warnings: string[],
): PublishedPortAllowance[] | undefined {
  if (!Array.isArray(value)) {
    warnings.push(
      `Rule "${ruleName}": option "${option}" must be an array of allowance objects — ignored.`,
    );
    return undefined;
  }

  const accepted: PublishedPortAllowance[] = [];
  for (const [index, entry] of value.entries()) {
    const prefix = `Rule "${ruleName}": option "${option}" entry ${index + 1}`;
    if (!isPlainObject(entry)) {
      warnings.push(`${prefix} must be an object — ignored.`);
      continue;
    }

    const unknown = Object.keys(entry).filter(
      (key) => !["service", "published", "reason"].includes(key),
    );
    if (unknown.length > 0) {
      warnings.push(
        `${prefix} has unknown ${unknown.length === 1 ? "key" : "keys"} ${unknown.map((key) => `"${key}"`).join(", ")} — ignored.`,
      );
      continue;
    }

    if (
      typeof entry.service !== "string" ||
      entry.service.trim() === "" ||
      entry.service !== entry.service.trim()
    ) {
      warnings.push(
        `${prefix} must have a non-empty "service" without surrounding whitespace — ignored.`,
      );
      continue;
    }
    if (!isStringArray(entry.published) || entry.published.length === 0) {
      warnings.push(
        `${prefix} must have a non-empty "published" array of strings — ignored.`,
      );
      continue;
    }

    const invalidPort = entry.published.find(
      (published) => !isValidPublishedPort(published),
    );
    if (invalidPort !== undefined) {
      warnings.push(
        `${prefix} has invalid published port "${invalidPort}"; expected <port-or-range>/<protocol> — ignored.`,
      );
      continue;
    }
    if (
      entry.reason !== undefined &&
      (typeof entry.reason !== "string" || entry.reason.trim() === "")
    ) {
      warnings.push(`${prefix} has an invalid "reason" — ignored.`);
      continue;
    }

    accepted.push({
      service: entry.service,
      published: entry.published.map((published) => published.toLowerCase()),
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    });
  }

  return accepted;
}

/**
 * Keeps only the options a rule declares, with the declared type. An unknown
 * option name is almost always a typo, and a value of the wrong type would make
 * the rule behave arbitrarily, so both are reported and dropped.
 */
function validateOptions(
  ruleName: string,
  options: Record<string, unknown>,
  warnings: string[],
): Record<string, unknown> {
  const declared = RULES_BY_NAME.get(ruleName)?.meta.options ?? {};
  const accepted: Record<string, unknown> = {};

  for (const [option, value] of Object.entries(options)) {
    const type = declared[option];
    if (!type) {
      const known = Object.keys(declared);
      const suffix =
        known.length > 0
          ? ` Known options: ${known.join(", ")}.`
          : " This rule takes no options.";
      warnings.push(
        `Rule "${ruleName}": unknown option "${option}" — ignored.${suffix}`,
      );
      continue;
    }

    if (type === "string[]" && !isStringArray(value)) {
      warnings.push(
        `Rule "${ruleName}": option "${option}" must be an array of strings — ignored.`,
      );
      continue;
    }

    if (type === "published-port-allowances") {
      const allowances = validatePublishedPortAllowances(
        ruleName,
        option,
        value,
        warnings,
      );
      if (allowances !== undefined) accepted[option] = allowances;
      continue;
    }

    accepted[option] = value;
  }

  return accepted;
}

/** Appends user glob patterns to the built-in defaults, validating as it goes. */
function normalizePatterns(
  value: unknown,
  defaults: readonly string[],
  option: string,
  warnings: string[],
): string[] {
  if (value === undefined) return [...defaults];

  if (!Array.isArray(value)) {
    warnings.push(`"${option}" must be an array of glob patterns — ignored.`);
    return [...defaults];
  }

  const patterns: string[] = [];
  for (const pattern of value) {
    if (typeof pattern !== "string") {
      warnings.push(
        `"${option}" entry ${JSON.stringify(pattern)} is not a string — ignored.`,
      );
      continue;
    }
    patterns.push(pattern);
  }

  return [...defaults, ...patterns];
}
