import type { Rule } from "../core/types.js";
import { requireHealthcheck } from "./best-practice/require-healthcheck.js";
import { requireName } from "./best-practice/require-name.js";
import { imageRequireTag } from "./security/image-require-tag.js";
import { noCapAddAll } from "./security/no-cap-add-all.js";
import { noHostNetwork } from "./security/no-host-network.js";
import { noPrivileged } from "./security/no-privileged.js";
import { noUnboundPorts } from "./security/no-unbound-ports.js";
import { specSchema } from "./spec/spec-schema.js";
import { noVersionField } from "./style/no-version-field.js";
import { serviceKeyOrder } from "./style/service-key-order.js";
import { topLevelOrder } from "./style/top-level-order.js";

export const allRules: Rule[] = [
  // Spec
  specSchema,
  // Style
  topLevelOrder,
  serviceKeyOrder,
  noVersionField,
  // Security
  noPrivileged,
  noHostNetwork,
  noCapAddAll,
  noUnboundPorts,
  imageRequireTag,
  // Best Practice
  requireName,
  requireHealthcheck,
];

export {
  imageRequireTag,
  noCapAddAll,
  noHostNetwork,
  noPrivileged,
  noUnboundPorts,
  noVersionField,
  requireHealthcheck,
  requireName,
  serviceKeyOrder,
  specSchema,
  topLevelOrder,
};
