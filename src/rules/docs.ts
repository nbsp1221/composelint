/**
 * Where each rule is documented.
 *
 * ESLint plugins repeat this URL in every rule's metadata because a plugin and
 * its docs can live anywhere. Here the docs live next to the rules, so the URL
 * is derived from the rule name and cannot drift out of sync.
 */
const DOCS_BASE_URL =
  "https://github.com/nbsp1221/composelint/blob/main/docs/rules";

export function ruleDocsUrl(ruleName: string): string {
  return `${DOCS_BASE_URL}/${ruleName}.md`;
}
