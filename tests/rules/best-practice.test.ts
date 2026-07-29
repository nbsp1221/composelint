import { describe, expect, it } from "vitest";
import { messagesFor, ruleIds } from "../helpers.js";

/** A one-service file whose service body is provided by the test. */
function service(body: string[]): string {
  return ["name: qa", "services:", "  web:", ...body, ""].join("\n");
}

describe("require-name require-name", () => {
  it("reports missing name", () => {
    expect(ruleIds("services:\n  web:\n    image: nginx:1\n")).toContain(
      "require-name",
    );
  });

  it("passes with name", () => {
    expect(
      ruleIds("name: app\nservices:\n  web:\n    image: nginx:1\n"),
    ).not.toContain("require-name");
  });
});

describe("require-name project name", () => {
  it("reports a missing name", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(messagesFor(source, "require-name")).toHaveLength(1);
  });

  it("reports an empty name", () => {
    for (const value of ['""', "''", '"   "']) {
      const source = [
        `name: ${value}`,
        "services:",
        "  web:",
        "    image: nginx:1.27",
        '    healthcheck: { test: ["CMD", "true"] }',
        "",
      ].join("\n");
      expect(messagesFor(source, "require-name"), value).toHaveLength(1);
    }
  });

  it("accepts a real name", () => {
    expect(
      messagesFor(
        service([
          "    image: nginx:1.27",
          '    healthcheck: { test: ["CMD", "true"] }',
        ]),
        "require-name",
      ),
    ).toEqual([]);
  });
});

describe("extends", () => {
  it("resolves a service extended within the same file", () => {
    const source = [
      "name: qa",
      "services:",
      "  base:",
      "    image: nginx:1.27",
      "    healthcheck:",
      '      test: ["CMD", "true"]',
      "  worker:",
      "    extends: base",
      '    command: ["worker"]',
      "",
    ].join("\n");
    expect(messagesFor(source, "require-healthcheck")).toEqual([]);
  });

  it("resolves the object form without a file", () => {
    const source = [
      "name: qa",
      "services:",
      "  base:",
      "    image: nginx:1.27",
      "    healthcheck:",
      '      test: ["CMD", "true"]',
      "  worker:",
      "    extends:",
      "      service: base",
      "",
    ].join("\n");
    expect(messagesFor(source, "require-healthcheck")).toEqual([]);
  });

  it("reports risky values inherited through extends", () => {
    const source = [
      "name: qa",
      "services:",
      "  base:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    privileged: true",
      "  worker:",
      "    extends: base",
      "",
    ].join("\n");
    const messages = messagesFor(source, "no-privileged");
    expect(messages).toContain(
      'Service "worker": privileged mode grants full access to the host (inherited)',
    );
  });

  it("lets local keys win over the extended definition", () => {
    const source = [
      "name: qa",
      "services:",
      "  base:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    privileged: true",
      "  worker:",
      "    extends: base",
      "    privileged: false",
      "",
    ].join("\n");
    // `base` itself is still reported; `worker` overrode the flag.
    expect(messagesFor(source, "no-privileged")).toEqual([
      'Service "base": privileged mode grants full access to the host',
    ]);
  });

  it("stays silent about a definition that lives in another file", () => {
    const source = [
      "name: qa",
      "services:",
      "  worker:",
      "    extends:",
      "      file: ./base.yaml",
      "      service: api",
      '    command: ["worker"]',
      "",
    ].join("\n");
    expect(messagesFor(source, "require-healthcheck")).toEqual([]);
  });

  it("survives a self-referencing extends", () => {
    const source = [
      "name: qa",
      "services:",
      "  loop:",
      "    extends: loop",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(messagesFor(source, "require-healthcheck")).toEqual([]);
  });

  it("survives a cycle between two services", () => {
    const source = [
      "name: qa",
      "services:",
      "  a:",
      "    extends: b",
      "    image: nginx:1.27",
      "  b:",
      "    extends: a",
      "    image: nginx:1.27",
      "",
    ].join("\n");
    expect(messagesFor(source, "require-healthcheck")).toHaveLength(2);
  });
});

describe("require-healthcheck provider services", () => {
  // A `provider` service is handled by an external binary, not by a container,
  // so Compose has nothing to run a healthcheck against.
  it("ignores a provider service", () => {
    const source = [
      "name: qa",
      "services:",
      "  ai:",
      "    provider:",
      "      type: model",
      "      options:",
      "        model: ai/smollm2",
      "",
    ].join("\n");
    expect(ruleIds(source)).not.toContain("require-healthcheck");
  });

  it("still reports a container service in the same file", () => {
    const source = [
      "name: qa",
      "services:",
      "  ai:",
      "    provider:",
      "      type: model",
      "  web:",
      "    image: nginx:1.27",
      "",
    ].join("\n");
    expect(messagesFor(source, "require-healthcheck")).toEqual([
      'Service "web": no healthcheck defined',
    ]);
  });
});
