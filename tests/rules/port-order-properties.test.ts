import { expect, it } from "vitest";
import { resolveConfig } from "../../src/config/loader.js";
import { ComposeDocument } from "../../src/core/document.js";
import { lintAndFix } from "../../src/core/linter.js";
import { servicePortsAlphabeticalOrder } from "../../src/rules/style/service-ports-alphabetical-order.js";

it("preserves static port bindings and their inline comments over varied inputs", () => {
  let state = 42;
  function random(limit: number): number {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state % limit;
  }
  const file = "compose.yaml";
  const rules = [servicePortsAlphabeticalOrder];
  const config = resolveConfig({
    rules: { "service-ports-alphabetical-order": "warn" },
  });
  let changed = 0;
  for (let testCase = 0; testCase < 500; testCase++) {
    const count = 2 + random(11);
    const used = new Set<number>();
    const rows: string[] = [];
    while (rows.length < count) {
      const port = 1000 + random(50000);
      if (used.has(port)) continue;
      used.add(port);
      const target = 1 + random(60000);
      const comment = `# item${rows.length}`;
      const form = random(3);
      rows.push(
        form === 0
          ? `      - {target: ${target}, published: "${port}"} ${comment}`
          : form === 1
            ? `      - "127.0.0.1:${port}:${target}" ${comment}`
            : `      - "${port}:${target}" ${comment}`,
      );
    }
    const source = `services:\n  app:\n    ports:\n${rows.join("\n")}\n`;
    const result = lintAndFix(source, file, rules, config);
    const original = new ComposeDocument(source, file).toJS() as {
      services: { app: { ports: unknown[] } };
    };
    const fixed = result.document.toJS() as {
      services: { app: { ports: unknown[] } };
    };
    const normalized = (values: unknown[]) =>
      values.map((entry) => JSON.stringify(entry)).sort();
    expect(normalized(fixed.services.app.ports), `case ${testCase}`).toEqual(
      normalized(original.services.app.ports),
    );
    for (const row of rows)
      expect(result.source, `case ${testCase}`).toContain(row);
    expect(
      lintAndFix(result.source, file, rules, config).changed,
      `case ${testCase}`,
    ).toBe(false);
    if (result.changed) changed++;
  }
  expect(changed).toBeGreaterThan(0);
});
