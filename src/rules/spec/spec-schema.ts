import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import composeSpecSchema from "../../../schemas/compose-spec.json" with {
  type: "json",
};
import { parseComposeBoolean } from "../../core/compose-boolean.js";
import type { Rule, RuleContext } from "../../core/types.js";
import { normalizeSchemaErrors } from "./schema-errors.js";

/** Tags Compose uses in override files; the tagged value is not real data. */
const MERGE_TAGS = new Set(["!reset", "!override"]);

/** Compose interpolates `${VAR}` before validating, so keys may contain it. */
const INTERPOLATION = /\$\{/;
const VALUE_INTERPOLATION =
  /(?:^|[^$])(?:\$\$)*\$(?:[a-zA-Z_]|\{[a-zA-Z_][^}]*\})/;

let compiled: ValidateFunction | null = null;

/** Compiles the vendored schema once per process (~90ms) and caches it. */
function getValidator(): ValidateFunction {
  if (compiled === null) {
    const ajv = new Ajv2020({
      allErrors: true,
      // The upstream schema is not written against ajv's strict mode.
      strict: false,
    });
    compiled = ajv.compile(composeSpecSchema as object);
  }
  return compiled;
}

/** True when the value, or any of its ancestors, carries a Compose merge tag. */
function hasMergeTag(
  context: RuleContext,
  path: ReadonlyArray<string | number>,
): boolean {
  for (let depth = path.length; depth >= 0; depth--) {
    const tag = context.document.getTagAtPath(path.slice(0, depth));
    if (tag !== undefined && MERGE_TAGS.has(tag)) return true;
  }
  return false;
}

/** The node a violation should be reported on, falling back up the path. */
function resolveNode(
  context: RuleContext,
  path: ReadonlyArray<string | number>,
  unknownKey: string | undefined,
): { range?: [number, number, number] | null } {
  const document = context.document;

  if (unknownKey !== undefined) {
    const keyNode = document.getKeyNodeAtPath(path, unknownKey);
    if (keyNode) return keyNode as { range?: [number, number, number] | null };
  }

  for (let depth = path.length; depth >= 0; depth--) {
    const node = document.getNodeAtPath(path.slice(0, depth));
    if (node && typeof node === "object" && "range" in node) {
      return node as { range?: [number, number, number] | null };
    }
  }

  return { range: null };
}

export const specSchema: Rule = {
  meta: {
    name: "spec-schema",
    category: "spec",
    description:
      "The file must conform to the Compose Specification JSON schema",
    fixable: false,
    defaultSeverity: "error",
  },
  create(context: RuleContext) {
    const data = context.document.toJS();

    // An empty document has nothing to validate; other rules stay silent too.
    if (data === null || data === undefined) return;

    const validate = getValidator();
    const errors = validate(data)
      ? null
      : (validate.errors as ErrorObject[] | null);
    const hasTags =
      context.document.source.includes("!reset") ||
      context.document.source.includes("!override");

    for (const violation of normalizeSchemaErrors(errors)) {
      // Values produced by `!reset` / `!override` are placeholders, not data.
      if (hasTags && hasMergeTag(context, violation.path)) continue;

      const [section, service, key] = violation.path;
      if (
        violation.path.length === 3 &&
        section === "services" &&
        typeof key === "string" &&
        context.document.inheritsNullField(String(service), key)
      ) {
        continue;
      }

      // A key written as `${SERVICE}` is resolved by Compose before parsing.
      if (
        violation.unknownKey !== undefined &&
        INTERPOLATION.test(violation.unknownKey)
      ) {
        continue;
      }

      context.report({
        message: violation.message,
        node: resolveNode(context, violation.path, violation.unknownKey),
      });
    }

    for (const [name, service] of Object.entries(
      context.document.getMergedServices() ?? {},
    )) {
      if (service === null || typeof service !== "object") continue;
      const { privileged } = service as Record<string, unknown>;
      if (
        typeof privileged !== "string" ||
        parseComposeBoolean(privileged) !== undefined ||
        VALUE_INTERPOLATION.test(privileged)
      ) {
        continue;
      }
      const path = ["services", name, "privileged"];
      if (
        hasTags &&
        (context.document.isResetService(name) ||
          context.document.getTagAtPath(path) === "!reset")
      ) {
        continue;
      }
      context.report({
        message: `Service "${name}": "privileged" must be a boolean or a Compose boolean string`,
        node: resolveNode(context, path, undefined),
      });
    }
  },
};
