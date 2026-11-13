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

describe("security sequences in same-file extends", () => {
  const source = `services:
  base:
    image: nginx:1
    ports: ["8080:80", "8081:81"]
    cap_add: [ALL, NET_ADMIN]
    privileged: true
  child:
    extends: {service: base}
    ports:
      - {target: 80, published: "8080"}
      - "8082:82"
    cap_add: [NET_ADMIN, SYS_PTRACE]
    privileged: false
  grandchild:
    extends: child
    ports:
      - "8083:83"
    cap_add: [SYS_CHROOT]
`;

  it("keeps parent-first order, removes duplicates and preserves scalar overrides", () => {
    const { document } = lint(source);
    expect(document.getMergedServiceValue("base", "ports")).toEqual([
      "8080:80",
      "8081:81",
    ]);
    expect(document.getMergedServiceValue("grandchild", "ports")).toEqual([
      { target: 80, published: "8080" },
      "8081:81",
      "8082:82",
      "8083:83",
    ]);
    expect(document.getMergedServiceValue("grandchild", "cap_add")).toEqual([
      "ALL",
      "NET_ADMIN",
      "SYS_PTRACE",
      "SYS_CHROOT",
    ]);
    expect(ruleIdsFor(source, "child")).not.toContain("no-privileged");
    expect(ruleIdsFor(source, "grandchild")).not.toContain("no-privileged");
  });

  it.each([
    [
      "child",
      [
        [10, 9, false],
        [8, 5, true],
        [11, 9, false],
      ],
      8,
    ],
    [
      "grandchild",
      [
        [15, 5, true],
        [15, 5, true],
        [15, 5, true],
        [17, 9, false],
      ],
      15,
    ],
  ])(
    "reports the correct sequence locations for %s",
    (name, ports, extendsLine) => {
      const diagnostics = diagnosticsFor(source, name);
      expect(
        diagnostics
          .filter(({ ruleId }) => ruleId === "no-unbound-ports")
          .map(({ range, message, fix }) => {
            expect(fix).toBeUndefined();
            return [
              range.start.line,
              range.start.column,
              message.endsWith("(inherited)"),
            ];
          }),
      ).toEqual(ports);
      expect(
        diagnostics.find(({ ruleId }) => ruleId === "no-cap-add-all"),
      ).toMatchObject({
        message: `Service "${name}": cap_add includes ALL Linux capabilities (inherited)`,
        range: { start: { line: extendsLine, column: 5 } },
      });
    },
  );

  it("distinguishes the extends key from a local YAML merge", () => {
    const yaml = `x-local: &local
  ports: ["8081:81"]
  cap_add: [ALL]
services:
  base:
    image: nginx:1
    ports: ["8080:80"]
    cap_add: [ALL]
  child:
    <<: *local
    extends: base
`;
    const diagnostics = diagnosticsFor(yaml, "child");
    expect(
      diagnostics
        .filter(({ ruleId }) => ruleId === "no-unbound-ports")
        .map(({ range }) => range.start.line),
    ).toEqual([11, 10]);
    expect(
      diagnostics.find(({ ruleId }) => ruleId === "no-cap-add-all")?.range.start
        .line,
    ).toBe(10);
  });

  it("keeps local diagnostics for descendants of an external extends", () => {
    const yaml = `services:
  base:
    extends: {file: ./elsewhere.yaml, service: child}
    ports: [80]
  child:
    extends: base
    ports: [81]
`;
    const diagnostics = diagnosticsFor(yaml, "child");
    expect(
      diagnostics
        .filter(({ ruleId }) => ruleId === "no-unbound-ports")
        .map(({ range }) => range.start.line),
    ).toEqual([6, 7]);
    expect(ruleIdsFor(yaml, "child")).not.toContain("require-healthcheck");
  });

  it("honors local sequence reset and override tags", () => {
    const yaml = `services:
  base:
    image: nginx:1
    ports: [80]
    cap_add: [ALL]
  child:
    extends: base
    ports: !override ["127.0.0.1:8080:80"]
    cap_add: !reset [ALL]
  grandchild:
    extends: child
`;
    for (const name of ["child", "grandchild"]) {
      expect(ruleIdsFor(yaml, name)).not.toContain("no-unbound-ports");
      expect(ruleIdsFor(yaml, name)).not.toContain("no-cap-add-all");
    }
  });

  it("honors tags from YAML merge lists and aliases", () => {
    const source = `x-reset: &reset !reset [ALL]
x-defaults: &defaults
  ports: !override ["127.0.0.1:8080:80"]
x-fallback: &fallback
  ports: [81]
services:
  base:
    image: nginx:1
    ports: [80]
    cap_add: [ALL]
  child:
    <<: [*defaults, *fallback]
    extends: base
    cap_add: *reset
  local:
    <<: *defaults
    extends: base
    ports: [82]
  alias:
    <<: *defaults
    extends: base
    cap_add: [NET_ADMIN]
`;
    const { document } = lint(source);
    expect(document.getMergedServiceValue("child", "ports")).toEqual([
      "127.0.0.1:8080:80",
    ]);
    expect(document.getMergedServiceValue("child", "cap_add")).toBeUndefined();
    expect(ruleIdsFor(source, "child")).not.toContain("no-unbound-ports");
    expect(ruleIdsFor(source, "child")).not.toContain("no-cap-add-all");
    expect(document.getMergedServiceValue("local", "ports")).toEqual([80, 82]);
    expect(ruleIdsFor(source, "alias")).not.toContain("no-unbound-ports");
  });

  it("inherits arrays through untagged nulls and validates other nulls", () => {
    const source = `services:
  base:
    image: nginx:1
    ports: [80]
    cap_add: [ALL]
  child:
    extends: base
    ports: null
    cap_add: null
  descendant:
    extends: child
    ports: []
  standalone:
    image: nginx:1
    ports: null
    cap_add: null
  missing:
    extends: standalone
    ports: null
    cap_add: null
`;
    const { document } = lint(source);
    expect(document.getMergedServiceValue("child", "ports")).toEqual([80]);
    expect(document.getMergedServiceValue("child", "cap_add")).toEqual(["ALL"]);
    for (const [name, line] of [
      ["child", 7],
      ["descendant", 11],
    ] as const) {
      const diagnostics = diagnosticsFor(source, name);
      expect(
        diagnostics.filter(({ ruleId }) => ruleId === "spec-schema"),
      ).toEqual([]);
      const warnings = diagnostics.filter(({ ruleId }) =>
        ["no-cap-add-all", "no-unbound-ports"].includes(ruleId),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings.map(({ range }) => range.start.line)).toEqual([
        line,
        line,
      ]);
    }
    for (const name of ["standalone", "missing"]) {
      expect(
        diagnosticsFor(source, name).filter(
          ({ ruleId }) => ruleId === "spec-schema",
        ),
      ).toHaveLength(2);
    }
  });

  it("honors tagged sequence aliases on a whole-service alias", () => {
    const source = `x-ports: &ports !override ["127.0.0.1:8080:80"]
x-caps: &caps !reset null
x-child: &child
  extends: base
  ports: *ports
  cap_add: *caps
services:
  base:
    image: nginx:1
    ports: [80]
    cap_add: [ALL]
  child: *child
`;
    const { document } = lint(source);
    expect(document.getMergedServiceValue("child", "ports")).toEqual([
      "127.0.0.1:8080:80",
    ]);
    expect(document.getMergedServiceValue("child", "cap_add")).toBeUndefined();
    expect(ruleIdsFor(source, "child")).not.toContain("no-unbound-ports");
    expect(ruleIdsFor(source, "child")).not.toContain("no-cap-add-all");
    expect(ruleIdsFor(source, "child")).not.toContain("spec-schema");
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
