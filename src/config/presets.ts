import type { Severity } from "../core/types.js";
import { allRules } from "../rules/index.js";

/**
 * Presets follow the convention shared by ESLint, typescript-eslint and Biome:
 * one default set plus one opt-in escalation.
 *
 * - `recommended` (default): uses each rule's declared default severity.
 *   Problems that Compose itself
 *   rejects or that are unambiguously obsolete are errors; opinionated checks
 *   are warnings so they do not break a pipeline on their own.
 * - `strict`: raises enabled rules to `error`. Opt-in rules stay off.
 *
 * There is deliberately no "minimal" or "none" preset. Loosening is done per
 * rule via `rules: { "<rule>": "off" }`, which is how ESLint, Biome and dclint
 * all handle it.
 */
export type PresetName = "recommended" | "strict";

export type PresetMap = Record<string, Severity>;

/** Every rule at its declared default severity. */
function buildRecommended(): PresetMap {
  return Object.fromEntries(
    allRules.map((rule) => [rule.meta.name, rule.meta.defaultSeverity]),
  );
}

/** Raise every enabled rule to `error`. */
function buildStrict(): PresetMap {
  return Object.fromEntries(
    allRules.map(({ meta }) => [
      meta.name,
      meta.defaultSeverity === "off" ? "off" : "error",
    ]),
  );
}

export const presets: Record<PresetName, PresetMap> = {
  recommended: buildRecommended(),
  strict: buildStrict(),
};

export const presetNames = Object.keys(presets) as PresetName[];

export const DEFAULT_PRESET: PresetName = "recommended";
