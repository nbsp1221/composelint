import type { RuleContext } from "../core/types.js";

/**
 * Reports a problem about a value inside a service.
 *
 * The three steps a rule would otherwise repeat — find the node, mark the value
 * as inherited when the service did not declare it, report — are kept together
 * here. A rule that forgot the middle step would still compile and pass its
 * tests, while the reported line (a `<<` alias or an `extends` entry) would give
 * no hint about where the value came from.
 */
export function reportServiceValue(
  context: RuleContext,
  service: string,
  path: ReadonlyArray<string | number>,
  message: string,
): void {
  const target = context.document.getServiceReportTarget(service, path);
  context.report({
    message: target.inherited ? `${message} (inherited)` : message,
    node: target.node,
  });
}
