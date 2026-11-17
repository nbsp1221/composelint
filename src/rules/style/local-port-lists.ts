import { isMap, isScalar, isSeq, type YAMLSeq } from "yaml";
import type { ComposeDocument } from "../../core/document.js";

/** Style rules inspect declarations at their written location. */
export function* localPortLists(
  document: ComposeDocument,
  fields: readonly ("ports" | "expose")[],
): Iterable<{ service: string; field: "ports" | "expose"; list: YAMLSeq }> {
  const root = document.root;
  const services = document.getServicesMap();
  if (
    !root ||
    !services ||
    !allowsStyle(root.tag) ||
    !allowsStyle(services.tag)
  )
    return;

  for (const { key, value } of services.items) {
    if (
      !isScalar(key) ||
      typeof key.value !== "string" ||
      !/^[A-Za-z0-9._-]+$/.test(key.value) ||
      !isMap(value) ||
      !allowsStyle(value.tag)
    )
      continue;
    for (const field of fields) {
      const list = value.get(field, true);
      if (isSeq(list) && allowsStyle(list.tag)) {
        yield { service: key.value, field, list };
      }
    }
  }
}

function allowsStyle(tag: string | undefined): boolean {
  return tag === undefined || tag === "!override";
}
