import type { ErrorObject } from "ajv";

/** A schema violation after noise reduction and message rewriting. */
export interface SchemaViolation {
  /** Path of keys and array indices to the offending value. */
  path: (string | number)[];
  /** Set when the violation is an unrecognised key. */
  unknownKey?: string;
  message: string;
}

const UMBRELLA_KEYWORDS = new Set(["oneOf", "anyOf", "allOf", "if", "not"]);

const CONTAINER_LABELS: Record<string, string> = {
  services: "Service",
  networks: "Network",
  volumes: "Volume",
  secrets: "Secret",
  configs: "Config",
  models: "Model",
};

const TYPE_PHRASES: Record<string, string> = {
  array: "an array",
  object: "a mapping",
  string: "a string",
  number: "a number",
  integer: "an integer",
  boolean: "a boolean",
  null: "null",
};

/** Turns a JSON Pointer into a path of keys and array indices. */
export function pointerToPath(instancePath: string): (string | number)[] {
  if (instancePath === "") return [];
  return instancePath
    .split("/")
    .slice(1)
    .map((segment) => {
      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      return /^\d+$/.test(key) ? Number(key) : key;
    });
}

function formatPath(path: ReadonlyArray<string | number>): string {
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc === "" ? segment : `${acc}.${segment}`;
  }, "");
}

interface Location {
  /** Message prefix such as `Service "web": `. */
  prefix: string;
  /** Human description of the offending value. */
  target: string;
  /** Path relative to a named container, if the path is inside one. */
  rest: (string | number)[];
}

function describeLocation(path: ReadonlyArray<string | number>): Location {
  if (path.length === 0) {
    return { prefix: "", target: "the document", rest: [] };
  }

  const label =
    typeof path[0] === "string" ? CONTAINER_LABELS[path[0]] : undefined;

  if (label && path.length >= 2) {
    const rest = path.slice(2);
    return {
      prefix: `${label} "${path[1]}": `,
      target: rest.length > 0 ? `"${formatPath(rest)}"` : "the definition",
      rest,
    };
  }

  return { prefix: "", target: `"${formatPath(path)}"`, rest: [] };
}

function joinTypes(types: string[]): string {
  const phrases = types.map((type) => TYPE_PHRASES[type] ?? `a ${type}`);
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(", ")} or ${phrases[phrases.length - 1]}`;
}

function collectTypes(errors: ErrorObject[]): string[] {
  const types: string[] = [];
  for (const error of errors) {
    const declared = (error.params as { type?: string | string[] }).type;
    const candidates = Array.isArray(declared)
      ? declared
      : typeof declared === "string"
        ? declared.split(",")
        : [];
    for (const type of candidates) {
      const trimmed = type.trim();
      if (trimmed !== "" && !types.includes(trimmed)) types.push(trimmed);
    }
  }
  return types;
}

function unknownKeyMessage(
  path: ReadonlyArray<string | number>,
  key: string,
): string {
  if (path.length === 0) {
    return `Unknown top-level key "${key}" is not part of the Compose Specification`;
  }

  const { prefix, rest } = describeLocation(path);
  if (prefix !== "") {
    const where = rest.length > 0 ? ` in "${formatPath(rest)}"` : "";
    return `${prefix}unknown key "${key}"${where} is not part of the Compose Specification`;
  }

  return `Unknown key "${key}" in "${formatPath(path)}" is not part of the Compose Specification`;
}

function violationMessage(
  path: ReadonlyArray<string | number>,
  detail: string,
): string {
  if (path.length === 0) {
    return `A Compose file must be a mapping of top-level keys (${detail})`;
  }
  const { prefix, target } = describeLocation(path);
  return `${prefix}${target} ${detail}`;
}

/**
 * Reduces raw ajv output to one violation per problem.
 *
 * A single mistake inside a `oneOf` produces an error per branch plus an
 * umbrella error, so errors are grouped by location: unrecognised keys win,
 * then any specific keyword, and type mismatches across branches collapse into
 * a single "must be X or Y" message.
 */
export function normalizeSchemaErrors(
  errors: ErrorObject[] | null | undefined,
): SchemaViolation[] {
  if (!errors || errors.length === 0) return [];

  const groups = new Map<string, ErrorObject[]>();
  for (const error of errors) {
    const existing = groups.get(error.instancePath);
    if (existing) existing.push(error);
    else groups.set(error.instancePath, [error]);
  }

  const violations: SchemaViolation[] = [];

  for (const [instancePath, group] of groups) {
    const path = pointerToPath(instancePath);

    const additional = group.filter(
      (error) => error.keyword === "additionalProperties",
    );
    if (additional.length > 0) {
      const seen = new Set<string>();
      for (const error of additional) {
        const key = String(
          (error.params as { additionalProperty?: unknown }).additionalProperty,
        );
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          path,
          unknownKey: key,
          message: unknownKeyMessage(path, key),
        });
      }
      continue;
    }

    const specific = group.filter(
      (error) =>
        !UMBRELLA_KEYWORDS.has(error.keyword) && error.keyword !== "type",
    );
    if (specific.length > 0) {
      const seen = new Set<string>();
      for (const error of specific) {
        const detail = error.message ?? "is invalid";
        if (seen.has(detail)) continue;
        seen.add(detail);
        violations.push({ path, message: violationMessage(path, detail) });
      }
      continue;
    }

    const typeErrors = group.filter((error) => error.keyword === "type");
    if (typeErrors.length > 0) {
      const types = collectTypes(typeErrors);
      const detail =
        types.length > 0
          ? `must be ${joinTypes(types)}`
          : "has an invalid type";
      violations.push({ path, message: violationMessage(path, detail) });
      continue;
    }

    const fallback = group[0];
    violations.push({
      path,
      message: violationMessage(path, fallback.message ?? "is invalid"),
    });
  }

  return violations;
}
