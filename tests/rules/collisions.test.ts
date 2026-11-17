import { describe, expect, it } from "vitest";
import { lintSource } from "../../src/core/linter.js";
import { allRules } from "../../src/rules/index.js";
import { diagnosticsFor, messagesFor, recommended } from "../helpers.js";

const NAME_RULE = "no-duplicate-container-names";
const PORT_RULE = "no-conflicting-published-ports";

function portPair(first: string, second: string) {
  return `services:
  first:
    image: nginx:1
    ports:
      - ${first}
  second:
    image: nginx:1
    ports:
      - ${second}
`;
}

describe("container name collisions", () => {
  it("warns once on the later literal name with no fix", () => {
    const source = `services:
  first: {image: nginx:1, container_name: shared}
  second:
    image: nginx:1
    container_name: shared
  case-sensitive: {image: nginx:1, container_name: Shared}
`;
    const diagnostics = diagnosticsFor(source, NAME_RULE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      range: { start: { line: 5, column: 21 } },
      message:
        'Service "second": container name "shared" is also used by service "first"',
    });
    expect(diagnostics[0].fix).toBeUndefined();
  });

  it("ignores unresolved and invalid names", () => {
    const source = `services:
  first: {image: nginx:1, container_name: "\${NAME:-shared}"}
  second: {image: nginx:1, container_name: "\${NAME:-shared}"}
  invalid-first: {image: nginx:1, container_name: 123}
  invalid-second: {image: nginx:1, container_name: 123}
`;
    expect(messagesFor(source, NAME_RULE)).toEqual([]);
  });
});

describe("static published-port collisions", () => {
  it.each([
    ['"8080:80"', '{target: 81, published: "8080", protocol: tcp}'],
    ['"0.0.0.0:8080:80"', '"127.0.0.1:8080:81"'],
    ['"127.0.0.1:8080:80"', '"8080:81"'],
    ['"[::]:8080:80"', '"[::1]:8080:81"'],
    ['"[0:0:0:0:0:0:0:1]:8080:80/udp"', '"[::1]:8080:81/udp"'],
    ['"8080-8082:80-82"', '"8081:81"'],
    ['{target: 80, published: "8080"}', '"8080-8082:80-82"'],
    ['"8080-8082:80-82"', '"8082-8084:90-92"'],
    ['"127.0.0.1:8080-8082:80-82"', '"0.0.0.0:8081-8083:91-93"'],
    ['"[::]:8080-8082:80-82/udp"', '"[::1]:8081:81/udp"'],
    ['"1-65535:1-65535"', '"65535:81"'],
    ['"0-2:80-82"', '"1:81"'],
    ['"8080-8080:80"', '"8080:81"'],
  ])(
    "reports overlapping bindings %s and %s on the later entry",
    (first, second) => {
      const diagnostics = diagnosticsFor(portPair(first, second), PORT_RULE);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        range: { start: { line: 9, column: 9 } },
      });
      expect(diagnostics[0].message).toContain(
        'may conflict with service "first"',
      );
      expect(diagnostics[0].fix).toBeUndefined();
    },
  );

  it.each([
    ['"127.0.0.1:8080:80"', '"127.0.0.2:8080:80"'],
    ['"0.0.0.0:8080:80"', '"[::]:8080:80"'],
    ['"8080:80/tcp"', '"8080:80/udp"'],
    ['"8080:80"', '"8081:80"'],
    ['"0:80"', "{target: 80, published: 0}"],
    ["80", "{target: 80}"],
    [`"\${PORT:-8080}:80"`, '"8080:80"'],
    [`"8080:\${TARGET:-80}"`, '"8080:80"'],
    [
      `{target: 80, published: 8080, host_ip: "\${HOST:-0.0.0.0}"}`,
      '"8080:80"',
    ],
    [`{target: 80, published: 8080, protocol: "\${PROTO:-tcp}"}`, '"8080:80"'],
    ['"8080-8082:80-82"', '"8083-8085:80-82"'],
    ['"8080-8082:80-82"', '"8079:81"'],
    ['"8080-8082:80-82"', '"8081:81/udp"'],
    ['"127.0.0.1:8080-8082:80-82"', '"127.0.0.2:8081:81"'],
    ['"0.0.0.0:8080-8082:80-82"', '"[::]:8081:81"'],
    ['"8080-8082:80"', '"8081:81"'],
    ['"8080:80-82"', '"8080:80"'],
    ['"8080-8082:80-81"', '"8081:81"'],
    ['"8082-8080:80-82"', '"8081:81"'],
    ['"8080-8082:82-80"', '"8081:81"'],
    ['"65535-65536:80-81"', '"65535:81"'],
    ['"8080-8082:65534-65536"', '"8081:81"'],
    ['"8080--8082:80-82"', '"8081:81"'],
    ['"8080-8082:80-82/tcp/udp"', '"8081:81/udp"'],
    ['"[::1:8080-8082:80-82"', '"[::1]:8081:81"'],
    ['"0-2:80-82"', '"0:80"'],
    ['"80-82"', '"81:81"'],
    [`"8080-8082:80-\${LAST:-82}"`, '"8081:81"'],
    ['{target: 80, published: "8080-8082"}', '"8081:81"'],
    ['"8081:81"', '{target: 80, published: "8080-8082"}'],
    ['{target: "80-82", published: "8080-8082"}', '"8081:81"'],
    ["{target: 80, published: 8080, host_ip: true}", '"8080:80"'],
  ])("does not infer a collision from %s and %s", (first, second) => {
    expect(messagesFor(portPair(first, second), PORT_RULE)).toEqual([]);
  });

  it("does not compare two mappings in the same service", () => {
    const source =
      'services:\n  first:\n    image: nginx:1\n    ports: ["8080:80", "8080:81"]\n';
    expect(messagesFor(source, PORT_RULE)).toEqual([]);
  });

  it("reports one warning for an overlapping inherited range", () => {
    const source = `services:
  base:
    image: nginx:1
    ports: ["8080-8082:80-82"]
  child:
    extends: base
  reset:
    extends: base
    ports: !reset ["8080-8082:80-82"]
`;
    const diagnostics = diagnosticsFor(source, PORT_RULE);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      message:
        'Service "child": host binding "0.0.0.0:8080-8082/tcp" may conflict with service "base" (inherited)',
      range: { start: { line: 6, column: 5 } },
    });
  });
});

describe("collision rule project scope", () => {
  const source = `x-unset: &unset
  container_name: !reset shared
  ports: !reset [8080:80]
services:
  base:
    image: nginx:1
    container_name: shared
    ports: ["8080:80"]
  inherited:
    extends: base
    container_name: null
    ports: ["127.0.0.1:8081:81"]
  reset:
    <<: *unset
    extends: base
  optional:
    extends: base
    profiles: [tools]
  inherited-profile:
    extends: optional
    profiles: []
  external:
    extends: {file: ./external.yaml, service: template}
    container_name: shared
    ports: ["8080:80"]
  delegated:
    provider: {type: example}
    container_name: shared
    ports: ["8080:80"]
`;

  it.each([NAME_RULE, PORT_RULE])(
    "uses effective values and skips uncertain services for %s",
    (rule) => {
      const diagnostics = diagnosticsFor(source, rule);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toMatch(
        /^Service "inherited": .+ \(inherited\)$/,
      );
      expect(diagnostics[0].range.start).toEqual({ line: 10, column: 5 });
    },
  );

  it.each([NAME_RULE, PORT_RULE])("skips partial files for %s", (rule) => {
    const output = lintSource(
      source,
      "compose.override.yaml",
      allRules,
      recommended,
      { partial: true },
    );
    expect(
      output.result.diagnostics.some(({ ruleId }) => ruleId === rule),
    ).toBe(false);
  });

  it("checks a service whose inherited profile is reset", () => {
    const yaml = `services:
  first:
    image: nginx:1
    container_name: shared
    ports: ["8080:80"]
  optional:
    extends: first
    profiles: [tools]
  regular:
    extends: optional
    profiles: !reset [tools]
`;
    for (const rule of [NAME_RULE, PORT_RULE]) {
      const messages = messagesFor(yaml, rule);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('Service "regular"');
    }
  });

  it("skips optional services even when they share a literal profile", () => {
    const yaml = `services:
  first: {image: nginx:1, container_name: shared, profiles: [tools], ports: ["8080:80"]}
  second: {image: nginx:1, container_name: shared, profiles: [tools], ports: ["8080:80"]}
  unknown: {image: nginx:1, container_name: shared, profiles: ["\${PROFILE}"], ports: ["8080:80"]}
  default: {image: nginx:1, container_name: shared, ports: ["8080:80"]}
`;
    expect(messagesFor(yaml, NAME_RULE)).toEqual([]);
    expect(messagesFor(yaml, PORT_RULE)).toEqual([]);
  });
});
