import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/loader.js";
import { ComposeDocument } from "../../src/core/document.js";
import { lintAndFix, lintSource } from "../../src/core/linter.js";
import { allRules } from "../../src/rules/index.js";
import { requireQuotesInPorts } from "../../src/rules/style/require-quotes-in-ports.js";
import { servicePortsAlphabeticalOrder } from "../../src/rules/style/service-ports-alphabetical-order.js";

const ordering = servicePortsAlphabeticalOrder.meta.name;
const quoting = requireQuotesInPorts.meta.name;
const rules = [servicePortsAlphabeticalOrder, requireQuotesInPorts];
const config = resolveConfig({
  rules: { [ordering]: "warn", [quoting]: "warn" },
});
const file = "compose.yaml";

function lint(source: string) {
  return lintSource(source, file, rules, config).result.diagnostics;
}

describe("opt-in port style", () => {
  it.each(["recommended", "strict"] as const)("is off in %s", (preset) => {
    const source = "services: {app: {ports: [9000:90, 8000:80]}}\n";
    const fixed = lintAndFix(source, file, allRules, resolveConfig({}, preset));
    expect(fixed.source).toBe(source);
    const ids = fixed.result.diagnostics.map(({ ruleId }) => ruleId);
    expect(ids).not.toContain(ordering);
    expect(ids).not.toContain(quoting);
  });

  it("compares numeric published ports across short and long forms", () => {
    const source = `services:
  app:
    ports:
      - "[::1]:900:80/udp"
      - {target: 80, published: 10000}
      - {target: 90, published: "10000", host_ip: "127.0.0.1"}
      - "127.0.0.1:8000:80"
`;
    expect(lint(source)).toMatchObject([
      {
        ruleId: ordering,
        message: expect.stringContaining("8000 should appear before 10000"),
        range: { start: { line: 7 } },
      },
    ]);
    const fixed = lintAndFix(source, file, rules, config).source;
    expect(fixed.indexOf('"127.0.0.1:8000:80"')).toBeLessThan(
      fixed.indexOf("published: 10000"),
    );
    expect(fixed.indexOf("published: 10000")).toBeLessThan(
      fixed.indexOf('published: "10000"'),
    );
  });

  it("diagnoses simple variable port expressions without unsafe autofix", () => {
    const source = `services:\n  app:\n    ports:\n      - "\${WEB_PORT}:80"\n      - "\${API_PORT}:80"\n`;
    expect(
      lint(source).filter(({ ruleId }) => ruleId === ordering),
    ).toHaveLength(1);
    expect(lintAndFix(source, file, rules, config).source).toBe(source);
  });

  it.each([
    ['"90"', '"80"'],
    [`"\${WEB_PORT:-9000}:80"`, `"\${API_PORT:-8000}:80"`],
  ])(
    "reports out of order target-only ports and default variables",
    (first, second) => {
      const source = `services:\n  app:\n    ports:\n      - ${first}\n      - ${second}\n`;
      expect(
        lint(source).filter(({ ruleId }) => ruleId === ordering),
      ).toHaveLength(1);
      expect(lintAndFix(source, file, rules, config).source).toBe(source);
    },
  );

  it("fixes a simple block list of distinct literal ports, preserving line endings", () => {
    const source =
      'services:\r\n  app:\r\n    ports:\r\n      - "9000:90"\r\n      - "8000:80"\r\n';
    const fixed = lintAndFix(source, file, rules, config);
    expect(fixed.source).toBe(
      source.replace(
        '"9000:90"\r\n      - "8000:80"',
        '"8000:80"\r\n      - "9000:90"',
      ),
    );
    expect(lintAndFix(fixed.source, file, rules, config).changed).toBe(false);
  });

  it("fixes disjoint static short-form ranges without changing their mappings", () => {
    const source = `services:
  app:
    ports:
      - "9000-9001:90-91" # web
      - "8000:80" # api
`;
    const expected = `services:
  app:
    ports:
      - "8000:80" # api
      - "9000-9001:90-91" # web
`;
    const result = lintAndFix(source, file, rules, config);
    expect(result.source).toBe(expected);
    expect(lintAndFix(result.source, file, rules, config).changed).toBe(false);
  });

  it.each([
    ['"9000-9001:90-91"', '"9000:90"', '"8000:80"'],
    ['"9000-9001:90"', '"8000:80"'],
  ])(
    "does not reorder overlapping or dynamically allocated ranges",
    (...ports) => {
      const source = `services:\n  app:\n    ports:\n${ports.map((port) => `      - ${port}\n`).join("")}`;
      expect(lintAndFix(source, file, rules, config).source).toBe(source);
    },
  );

  it("does not reorder unresolved long bindings that can collapse to the same Compose port", () => {
    const source = `services:
  app:
    ports:
      - target: 80
        published: "\${Z_PORT}"
        name: web
      - target: 80
        published: "\${A_PORT}"
        name: api
`;
    // When the two variables resolve to the same port, Compose keeps the
    // later entry's name; changing order would change the effective model.
    expect(
      lint(source).filter(({ ruleId }) => ruleId === ordering),
    ).toHaveLength(1);
    expect(lintAndFix(source, file, rules, config).source).toBe(source);
  });

  it("fixes distinct fixed ports in mixed short and long form", () => {
    const source = `services:
  app:
    ports:
      # web
      - target: 90
        published: "9000"
        protocol: tcp
      # api
      - "8000:80"
`;
    const expected = `services:
  app:
    ports:
      # api
      - "8000:80"
      # web
      - target: 90
        published: "9000"
        protocol: tcp
`;
    const fixed = lintAndFix(source, file, rules, config);
    expect(fixed.source).toBe(expected);
    expect(lintAndFix(fixed.source, file, rules, config).changed).toBe(false);
  });

  it("moves comments with their bindings, retaining unrelated comments", () => {
    const source = `# project header
services:
  app:
    ports:
      # web
      - "9000:90" # web inline
      # api
      - "8000:80" # api inline
`;
    const expected = `# project header
services:
  app:
    ports:
      # api
      - "8000:80" # api inline
      # web
      - "9000:90" # web inline
`;
    expect(lintAndFix(source, file, rules, config).source).toBe(expected);
  });

  it("stably sorts fixed duplicates without changing their relative precedence", () => {
    const source = `services:
  app:
    ports:
      - {target: 80, published: "9000", name: web}
      - {target: 80, published: "9000", name: api}
      - "8000:80"
`;
    const fixed = lintAndFix(source, file, rules, config).source;
    expect(fixed.indexOf('"8000:80"')).toBeLessThan(fixed.indexOf("name: web"));
    expect(fixed.indexOf("name: web")).toBeLessThan(fixed.indexOf("name: api"));
    expect(lintAndFix(fixed, file, rules, config).changed).toBe(false);
  });

  it("does not mistake ampersands or stars in ordinary text for YAML references", () => {
    const source = `services:
  app:
    environment:
      URL: "https://example.com/?a=1&b=*"
    ports:
      - "9000:90" # web & admin
      - "8000:80"
`;
    const fixed = lintAndFix(source, file, rules, config).source;
    expect(fixed.indexOf('"8000:80"')).toBeLessThan(fixed.indexOf('"9000:90"'));
    expect(fixed).toContain('URL: "https://example.com/?a=1&b=*"');
    expect(fixed).toContain('"9000:90" # web & admin');
  });

  it("does not reorder when the document contains YAML references", () => {
    const source = `x-port: &saved "7000:70"
services:
  app:
    ports:
      - "9000:90"
      - "8000:80"
x-copy: *saved
`;
    expect(lintAndFix(source, file, rules, config).source).toBe(source);
  });

  it("does not move suppression directives", () => {
    const source = `services:
  app:
    ports:
      - "9000:90" # composelint-disable-line another-rule
      - "8000:80"
`;
    expect(lintAndFix(source, file, rules, config).source).toBe(source);
  });

  it.each([
    '"0:80"',
    '{target: 80, published: "7000-7001"}',
    '{target: 80, published: "70000"}',
    '"7000::80"',
    "*port",
  ])("treats %s as a boundary between fixed bindings", (boundary) => {
    const source = `x-port: &port "7000:80"
services:
  app:
    ports: ["9000:90", ${boundary}, "8000:80"]
`;
    expect(lint(source).filter(({ ruleId }) => ruleId === ordering)).toEqual(
      [],
    );
  });

  it("quotes single tokens with comments, anchors, tags, CRLF and interpolation intact", () => {
    const binding = `\${HOST_PORT:-\${OTHER_PORT:-9000}}:90/tcp`;
    const source = [
      "services:",
      "  app:",
      "    ports: !override",
      "      - &binding 80:23 # keep",
      `      - ${binding}`,
      '      - "8000:80"',
      "    expose: [81-82/udp, '83/tcp', 84]",
      "x-copy: *binding",
    ].join("\r\n");
    const fixed = lintAndFix(source, file, rules, config);
    expect(fixed.source).toBe(
      source
        .replace("80:23 #", '"80:23" #')
        .replace(binding, `"${binding}"`)
        .replace("81-82/udp,", '"81-82/udp",'),
    );
    expect(fixed.document.toJS()).toEqual(
      new ComposeDocument(source, file).toJS(),
    );
    expect(fixed.document.getTagAtPath(["services", "app", "ports"])).toBe(
      "!override",
    );
    expect(
      lint(fixed.source).filter(({ ruleId }) => ruleId === quoting),
    ).toMatchObject([
      {
        ruleId: quoting,
        message: expect.stringContaining('"84"'),
        fix: undefined,
      },
    ]);
    expect(lintAndFix(fixed.source, file, rules, config).changed).toBe(false);
  });

  it("reports bare numbers and explicit scalar tags without changing YAML types", () => {
    const source = `%YAML 1.1
---
services:
  app:
    ports:
      - &number 80:23
      - !!str 8000:80
    expose: [80, 0x50]
x-reuse: *number
`;
    expect(
      lint(source).filter(({ ruleId }) => ruleId === quoting),
    ).toMatchObject([
      { fix: undefined },
      { fix: undefined },
      { fix: undefined },
    ]);
    expect(lintAndFix(source, file, rules, config).source).toBe(source);
  });

  it("skips inherited, aliased, reset, long and complex entries", () => {
    const source = `x-list: &ports [9000:90, 8000:80]
x-base: &base {ports: *ports}
services:
  merged: {<<: *base}
  aliased: {ports: *ports}
  inherited: {extends: {service: merged}}
  removed: !reset {ports: [9000:90, 8000:80]}
  app:
    ports: !reset [9000:90, 8000:80]
    expose:
      - !reset 80/tcp
      - |-
        81/tcp
  long: {ports: [{target: 80, published: 8000}]}
`;
    expect(lint(source)).toEqual([]);
  });

  it("honors suppression at each token and skips volume quotes", () => {
    const source = `services:
  app:
    ports:
      - 8000:80 # composelint-disable-line require-quotes-in-ports
      - 9000:90
    volumes:
      - "./dir # staging:/data"
`;
    const fixed = lintAndFix(source, file, rules, config);
    expect(fixed.source).toBe(source.replace("9000:90", '"9000:90"'));
  });

  it("keeps duplicate anchors bound to their original tokens in flow and block lists", () => {
    const source = `services:
  app:
    ports: [&p 9000:90, 8000:80]
  another:
    ports:
      - &p 7000:70
x-copy: *p
`;
    const fixed = lintAndFix(source, file, rules, config);
    expect(fixed.source).toContain('ports: [&p "9000:90", "8000:80"]');
    expect(fixed.source).toContain('- &p "7000:70"');
    expect(fixed.document.toJS()).toEqual(
      new ComposeDocument(source, file).toJS(),
    );
  });

  it("honors an order suppression on the offending binding", () => {
    const source = `services:
  app:
    ports:
      - "9000:90"
      - "8000:80" # composelint-disable-line service-ports-alphabetical-order
`;
    expect(lint(source)).toEqual([]);
  });
});
