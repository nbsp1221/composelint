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

  it("compares numeric published ports across short and long forms and never reorders", () => {
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
        fix: undefined,
      },
    ]);
    expect(lintAndFix(source, file, rules, config).source).toBe(source);
  });

  it.each([
    "80",
    '"0:80"',
    '"7000-7001:80-81"',
    '{target: 80, published: "7000-7001"}',
    '{target: 80, published: "70000"}',
    `"\${PUBLISHED:-7000}:80"`,
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
    expect(lint(fixed.source)).toMatchObject([
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
