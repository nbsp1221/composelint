import type { ComposeDocument } from "../../core/document.js";

export function* collisionServices(document: ComposeDocument) {
  for (const name of document.getMergedServiceNames()) {
    const service = document.getMergedService(name);
    if (!service || document.hasExternalExtends(name)) continue;
    const { profiles, provider } = service;
    if (provider !== undefined) continue;
    if (
      profiles !== undefined &&
      !(Array.isArray(profiles) && profiles.length === 0)
    ) {
      continue;
    }
    yield { name, service };
  }
}
