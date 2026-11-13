import type { Rule } from "../../core/types.js";
import { reportServiceValue } from "../report.js";
import { collisionServices } from "./collision-services.js";

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

export const noDuplicateContainerNames: Rule = {
  meta: {
    name: "no-duplicate-container-names",
    category: "best-practice",
    description: "Services should use distinct literal container names",
    requiresFullProject: true,
    fixable: false,
    defaultSeverity: "warn",
  },
  create(context) {
    const names = new Map<string, string>();
    for (const { name, service } of collisionServices(context.document)) {
      const container = service.container_name;
      if (typeof container !== "string" || !CONTAINER_NAME.test(container)) {
        continue;
      }
      const previous = names.get(container);
      if (previous === undefined) {
        names.set(container, name);
      } else {
        reportServiceValue(
          context,
          name,
          ["container_name"],
          `Service "${name}": container name "${container}" is also used by service "${previous}"`,
        );
      }
    }
  },
};
