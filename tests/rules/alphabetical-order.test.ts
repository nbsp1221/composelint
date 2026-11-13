import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/loader.js";
import { lintAndFix, lintSource } from "../../src/core/linter.js";
import { allRules } from "../../src/rules/index.js";

const services = "services-alphabetical-order";
const dependencies = "service-dependencies-alphabetical-order";
const config = resolveConfig({
  rules: { [services]: "warn", [dependencies]: "error" },
});
const file = "compose.yaml";

function orderingDiagnostics(source: string) {
  return lintSource(source, file, allRules, config).result.diagnostics.filter(
    ({ ruleId }) => ruleId === services || ruleId === dependencies,
  );
}

const source = `name: qa
services:
  # Worker service
  worker:
    image: busybox:1
    depends_on:
      # Wait for cache
      cache: { condition: service_healthy, required: false }
      api: { condition: service_started } # API dependency
  cache:
    image: busybox:1
    depends_on:
      - app2 # Secondary app
      # Primary app
      - app10
  app2: { image: busybox:1 }
  app10: { image: busybox:1 }
  api: { image: busybox:1 }
  App: { image: busybox:1 }
`;

describe("alphabetical ordering", () => {
  it.each(["recommended", "strict"] as const)(
    "keeps both rules off in %s, even when fixing",
    (preset) => {
      const outcome = lintAndFix(
        source,
        file,
        allRules,
        resolveConfig({}, preset),
      );
      expect(outcome.source).toBe(source);
      const ruleIds = outcome.result.diagnostics.map(({ ruleId }) => ruleId);
      expect(ruleIds).not.toContain(services);
      expect(ruleIds).not.toContain(dependencies);
    },
  );

  it("sorts service names and both dependency forms, moving comments and preserving dependency settings", () => {
    const before = orderingDiagnostics(source);
    expect(before.map(({ ruleId, severity }) => [ruleId, severity])).toEqual([
      [services, "warn"],
      [dependencies, "error"],
      [dependencies, "error"],
    ]);
    expect(before.map(({ range }) => range.start.line)).toEqual([4, 8, 13]);
    expect(before.every(({ fix }) => Boolean(fix))).toBe(true);

    const first = lintAndFix(source, file, allRules, config);
    expect(first.source).toBe(`name: qa
services:
  App: { image: busybox:1 }
  api: { image: busybox:1 }
  app10: { image: busybox:1 }
  app2: { image: busybox:1 }
  cache:
    image: busybox:1
    depends_on:
      # Primary app
      - app10
      - app2 # Secondary app
  # Worker service
  worker:
    image: busybox:1
    depends_on:
      api: { condition: service_started } # API dependency
      # Wait for cache
      cache: { condition: service_healthy, required: false }
`);
    expect(orderingDiagnostics(first.source)).toEqual([]);
    expect(lintAndFix(first.source, file, allRules, config).changed).toBe(
      false,
    );
  });

  it("preserves CRLF and an unterminated last line in a short list", () => {
    const input =
      "name: qa\r\nservices:\r\n  app:\r\n    depends_on:\r\n    - z\r\n    - a";
    const fixed = lintAndFix(input, file, allRules, config);
    expect(fixed.source).toBe(
      input.replace("    - z\r\n    - a", "    - a\r\n    - z"),
    );
  });

  it("moves a trailing nested comment with its service", () => {
    const input = `name: qa
services:
  z:
    image: busybox:1
  a:
    image: busybox:1
    # About a
volumes: {}
`;
    const fixed = lintAndFix(input, file, allRules, config);
    expect(fixed.source).toContain(
      "  a:\n    image: busybox:1\n    # About a\n  z:\n",
    );
  });

  it("reports each flow collection without a fix", () => {
    const input = `name: qa
services: { z: { depends_on: [zeta, alpha] }, a: { depends_on: { zeta: { condition: service_started }, alpha: { condition: service_started } } } }
`;
    expect(
      orderingDiagnostics(input).map(({ ruleId, fix }) => [ruleId, fix]),
    ).toEqual([
      [services, undefined],
      [dependencies, undefined],
      [dependencies, undefined],
    ]);
  });

  it.each([
    [
      "a unique anchor used inside the moved mapping",
      `services:
  z: &base { image: busybox:1 }
  a: *base
`,
    ],
    [
      "a duplicate anchor used after the moved mapping",
      `services:
  z: { command: &shared first }
  a: { command: &shared second }
x-selected: *shared
`,
    ],
    [
      "a multiline scalar whose chomping can change",
      `services:
  z:
    command: |+
      keep the blank line

  a: {}
`,
    ],
    [
      "an explicit mapping key",
      `services:
  ? z
  : {}
  a: {}
`,
    ],
    [
      "a shallower comment inside a service value",
      `services:
  z: {}
  a:
    image: busybox:1
# This comment breaks the service's indentation.
    command: echo hi
`,
    ],
  ])("declines to move %s", (_label, input) => {
    const diagnostic = orderingDiagnostics(input);
    expect(diagnostic).toHaveLength(1);
    expect(diagnostic[0]).toMatchObject({ ruleId: services, fix: undefined });
    const cfg = resolveConfig({
      rules: { [services]: "warn", "top-level-order": "off" },
    });
    expect(lintAndFix(input, file, allRules, cfg).source).toBe(input);
  });

  it("moves entries with an external merge anchor and preserves override and reset tags", () => {
    const input = `x-base: &base { image: busybox:1 }
name: qa
services: !override
  z:
    <<: *base
    depends_on: !override
      - zeta
      - alpha
  removed: !reset { depends_on: [zeta, alpha] }
  a: { image: busybox:1 }
`;
    const after = lintAndFix(input, file, allRules, config);
    expect(after.source).toBe(`x-base: &base { image: busybox:1 }
name: qa
services: !override
  a: { image: busybox:1 }
  removed: !reset { depends_on: [zeta, alpha] }
  z:
    <<: *base
    depends_on: !override
      - alpha
      - zeta
`);
    expect(after.document.getTagAtPath(["services"])).toBe("!override");
    expect(after.document.getTagAtPath(["services", "removed"])).toBe("!reset");
    expect(after.document.getTagAtPath(["services", "z", "depends_on"])).toBe(
      "!override",
    );
    expect(after.document.getMergedServiceValue("z", "image")).toBe(
      "busybox:1",
    );
  });

  it("leaves an anchored list intact when an alias can use it as a command", () => {
    const input = `name: qa
services:
  a:
    depends_on: &args
      - z
      - a
    command: *args
`;
    expect(orderingDiagnostics(input)).toMatchObject([
      { ruleId: dependencies, fix: undefined },
    ]);
    expect(lintAndFix(input, file, allRules, config).source).toBe(input);
  });

  it("skips reset collections, merges, aliases and repeated dependencies", () => {
    const input = `x-dependencies: &deps [z, a]
x-service: &service { depends_on: [z, a] }
x-services: &services { z: {}, a: {} }
services:
  <<: *services
  z: *service
  d: { depends_on: [z, a, z] }
  c: { depends_on: !reset [z, a] }
  b: { depends_on: *deps }
  a: { <<: *service }
`;
    expect(orderingDiagnostics(input)).toEqual([]);
    expect(orderingDiagnostics("services: !reset { z: {}, a: {} }\n")).toEqual(
      [],
    );
  });

  it("honors a suppressed diagnostic and preserves directives in report-only blocks", () => {
    const suppressed = `name: qa
services:
  # composelint-disable-next-line services-alphabetical-order
  z: {}
  a: {}
`;
    expect(orderingDiagnostics(suppressed)).toEqual([]);
    expect(lintAndFix(suppressed, file, allRules, config).source).toBe(
      suppressed,
    );
    const directive = suppressed
      .replace(
        "  # composelint-disable-next-line services-alphabetical-order\n",
        "",
      )
      .replace(
        "  a: {}",
        "  a: {} # composelint-disable-line require-healthcheck",
      );
    expect(orderingDiagnostics(directive)).toMatchObject([
      { ruleId: services, fix: undefined },
    ]);
  });
});
