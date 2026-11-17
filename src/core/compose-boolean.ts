const TRUE_VALUES = new Set(["true", "yes", "on", "y"]);
const FALSE_VALUES = new Set(["false", "no", "off", "n"]);

export function parseComposeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}
