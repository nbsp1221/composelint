import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/loader.js";
import { lintSource } from "../../src/core/linter.js";
import { allRules } from "../../src/rules/index.js";

const config = resolveConfig({});

function lint(source: string) {
  return lintSource(source, "compose.yaml", allRules, config);
}

function diagnosticsFor(source: string, service: string) {
  return lint(source).result.diagnostics.filter((d) =>
    d.message.includes(`"${service}"`),
  );
}

function ruleIdsFor(source: string, service: string): string[] {
  return [
    ...new Set(diagnosticsFor(source, service).map((d) => d.ruleId)),
  ].sort();
}

describe("direct and inherited configuration are equivalent", () => {
  const source = [
    "name: qa",
    "x-risky: &risky",
    "  image: nginx",
    "  privileged: true",
    "  network_mode: host",
    "  cap_add:",
    "    - ALL",
    "  ports:",
    '    - "3000:3000"',
    "services:",
    "  direct:",
    "    image: nginx",
    "    privileged: true",
    "    network_mode: host",
    "    cap_add:",
    "      - ALL",
    "    ports:",
    '      - "3000:3000"',
    "  via-anchor:",
    "    <<: *risky",
    "",
  ].join("\n");

  it("reports the same rules for both services", () => {
    const direct = ruleIdsFor(source, "direct").filter(
      (id) => id !== "service-key-order", // key order only applies to keys written in place
    );
    expect(ruleIdsFor(source, "via-anchor")).toEqual(direct);
  });

  it("finds every security problem behind the anchor", () => {
    expect(ruleIdsFor(source, "via-anchor")).toEqual([
      "image-require-tag",
      "no-cap-add-all",
      "no-host-network",
      "no-privileged",
      "no-unbound-ports",
      "require-healthcheck",
    ]);
  });
});

describe("inherited values no longer produce false positives", () => {
  const source = [
    "name: qa",
    "x-base: &base",
    "  image: nginx:1.27",
    "  healthcheck:",
    '    test: ["CMD", "true"]',
    "services:",
    "  inherits-good:",
    "    <<: *base",
    "",
  ].join("\n");

  it("sees an inherited healthcheck", () => {
    expect(ruleIdsFor(source, "inherits-good")).toEqual([]);
  });

  it("sees an inherited pinned image", () => {
    expect(
      diagnosticsFor(source, "inherits-good").some(
        (d) => d.ruleId === "image-require-tag",
      ),
    ).toBe(false);
  });
});

describe("local values win over inherited ones", () => {
  it("does not report when the service overrides a risky default", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  privileged: true",
      "services:",
      "  web:",
      "    <<: *base",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    privileged: false",
      "",
    ].join("\n");
    expect(ruleIdsFor(source, "web")).toEqual([]);
  });

  it("reports when the service adds a risky value to a safe default", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  privileged: false",
      "services:",
      "  web:",
      "    <<: *base",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    privileged: true",
      "",
    ].join("\n");
    expect(ruleIdsFor(source, "web")).toEqual(["no-privileged"]);
  });
});

describe("diagnostic location and message", () => {
  it("points at the alias and marks the message as inherited", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  privileged: true",
      "services:",
      "  web:",
      "    <<: *base",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");

    const found = diagnosticsFor(source, "web").filter(
      (d) => d.ruleId === "no-privileged",
    );
    expect(found).toHaveLength(1);
    expect(found[0].range.start.line).toBe(6);
    expect(found[0].message).toBe(
      'Service "web": privileged mode grants full access to the host (inherited)',
    );
  });

  it("points at the value itself when it is written in the service", () => {
    const source = [
      "name: qa",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    privileged: true",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");

    const found = diagnosticsFor(source, "web").filter(
      (d) => d.ruleId === "no-privileged",
    );
    expect(found).toHaveLength(1);
    expect(found[0].range.start.line).toBe(5);
    expect(found[0].message).not.toContain("inherited");
  });

  it("points at the merge key when several anchors are merged", () => {
    const source = [
      "name: qa",
      "x-a: &a",
      "  image: nginx:1.27",
      "x-b: &b",
      "  privileged: true",
      "services:",
      "  web:",
      "    <<: [*a, *b]",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");

    const found = diagnosticsFor(source, "web").filter(
      (d) => d.ruleId === "no-privileged",
    );
    expect(found).toHaveLength(1);
    expect(found[0].range.start.line).toBe(8);
    expect(found[0].message).toContain("(inherited)");
  });
});

describe("a service that is entirely an alias", () => {
  const source = [
    "name: qa",
    "x-base: &base",
    "  image: nginx",
    "  privileged: true",
    "services:",
    "  web: *base",
    "",
  ].join("\n");

  it("is linted instead of silently skipped", () => {
    expect(ruleIdsFor(source, "web")).toEqual([
      "image-require-tag",
      "no-privileged",
      "require-healthcheck",
    ]);
  });

  it("reports on the alias line", () => {
    const found = diagnosticsFor(source, "web").filter(
      (d) => d.ruleId === "no-privileged",
    );
    expect(found[0].range.start.line).toBe(6);
  });
});

describe("interaction with other features", () => {
  it("keeps inherited keys out of the key order check", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  healthcheck:",
      '    test: ["CMD", "true"]',
      "services:",
      "  web:",
      "    <<: *base",
      "    image: nginx:1.27",
      "    ports:",
      '      - "127.0.0.1:8080:80"',
      "",
    ].join("\n");
    expect(ruleIdsFor(source, "web")).toEqual([]);
  });

  it("can be suppressed on the alias line", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  privileged: true",
      "services:",
      "  web:",
      "    <<: *base  # composelint-disable-line no-privileged",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ruleIdsFor(source, "web")).toEqual([]);
  });

  it("treats a reset value as removed rather than as data", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  ports:",
      '    - "3000:3000"',
      "services:",
      "  web:",
      "    <<: *base",
      "    image: nginx:1.27",
      "    ports: !reset null",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ruleIdsFor(source, "web")).toEqual([]);
  });

  it("still validates the merged result against the schema", () => {
    const source = [
      "name: qa",
      "x-base: &base",
      "  typo_key: true",
      "services:",
      "  web:",
      "    <<: *base",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ruleIdsFor(source, "web")).toContain("spec-schema");
  });
});
