import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/loader.js";
import { lintAndFix } from "../../src/core/linter.js";
import { allRules } from "../../src/rules/index.js";
import {
  DEFAULT_SERVICE_KEY_ORDER,
  DEFAULT_TOP_LEVEL_ORDER,
  SERVICE_KEY_GROUPS,
} from "../../src/rules/style/key-order.js";
import { lint, messagesFor, recommended, ruleIds } from "../helpers.js";

function fixSource(source: string, config = recommended) {
  return lintAndFix(source, "compose.yaml", allRules, config);
}

/** Keys the vendored Compose schema defines, as the source of truth. */
function schemaKeys(pointer: "service" | "top"): string[] {
  const schema = JSON.parse(
    readFileSync(
      new URL("../../schemas/compose-spec.json", import.meta.url),
      "utf-8",
    ),
  ) as {
    properties: Record<string, unknown>;
    $defs: { service: { properties: Record<string, unknown> } };
  };
  return pointer === "service"
    ? Object.keys(schema.$defs.service.properties)
    : Object.keys(schema.properties);
}

describe("top-level-order top-level-order", () => {
  it("passes when keys are in order", () => {
    expect(
      ruleIds(
        "name: app\nservices:\n  web:\n    image: nginx:1\nvolumes:\n  data:\n",
      ),
    ).not.toContain("top-level-order");
  });

  it("reports when keys are out of order", () => {
    expect(
      ruleIds("volumes:\n  data:\nservices:\n  web:\n    image: nginx:1\n"),
    ).toContain("top-level-order");
  });

  it("fix reorders keys", () => {
    const source = "volumes:\n  data:\nservices:\n  web:\n    image: nginx:1\n";
    const { source: fixed } = fixSource(source);
    expect(fixed.indexOf("services:")).toBeLessThan(fixed.indexOf("volumes:"));
  });
});

describe("service-key-order service-key-order", () => {
  it("passes when service keys are in order", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: nginx:1\n    ports:\n      - '80:80'\n",
      ),
    ).not.toContain("service-key-order");
  });

  it("reports when service keys are out of order", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    ports:\n      - '80:80'\n    image: nginx:1\n",
      ),
    ).toContain("service-key-order");
  });
});

describe("no-version-field no-version-field", () => {
  it("reports version field as error", () => {
    const d = lint(
      'version: "3.8"\nservices:\n  web:\n    image: nginx:1\n',
    ).diagnostics.find(
      (diagnostic) => diagnostic.ruleId === "no-version-field",
    );
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.fix).toBeDefined();
  });

  it("passes without version field", () => {
    expect(ruleIds("services:\n  web:\n    image: nginx:1\n")).not.toContain(
      "no-version-field",
    );
  });

  it("fix removes version", () => {
    const { source: fixed } = fixSource(
      'version: "3.8"\nservices:\n  web:\n    image: nginx:1\n',
    );
    expect(fixed).not.toContain("version");
    expect(fixed).toContain("services:");
  });
});

describe("key order coverage", () => {
  it("places every service key the specification defines", () => {
    const missing = schemaKeys("service").filter(
      (key) => !DEFAULT_SERVICE_KEY_ORDER.includes(key),
    );
    expect(missing).toEqual([]);
  });

  it("places every top-level key the specification defines", () => {
    // `version` is deliberately unordered: no-version-field asks for its removal, so
    // top-level-order treats it as position-independent instead of giving it a slot.
    const missing = schemaKeys("top").filter(
      (key) => key !== "version" && !DEFAULT_TOP_LEVEL_ORDER.includes(key),
    );
    expect(missing).toEqual([]);
    expect(DEFAULT_TOP_LEVEL_ORDER).not.toContain("version");
  });

  it("does not invent keys the specification does not have", () => {
    const spec = new Set(schemaKeys("service"));
    expect(DEFAULT_SERVICE_KEY_ORDER.filter((key) => !spec.has(key))).toEqual(
      [],
    );
  });

  it("lists each key exactly once", () => {
    expect(new Set(DEFAULT_SERVICE_KEY_ORDER).size).toBe(
      DEFAULT_SERVICE_KEY_ORDER.length,
    );
    expect(new Set(DEFAULT_TOP_LEVEL_ORDER).size).toBe(
      DEFAULT_TOP_LEVEL_ORDER.length,
    );
  });

  it("keeps groups disjoint", () => {
    const seen = new Set<string>();
    for (const keys of Object.values(SERVICE_KEY_GROUPS)) {
      for (const key of keys) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("keys that used to be pushed to the end", () => {
  it("accepts extends before the keys it overrides", () => {
    const source = [
      "name: qa",
      "services:",
      "  worker:",
      "    extends:",
      "      file: ./compose.yaml",
      "      service: api",
      "    configs:",
      "      - app_config",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ruleIds(source)).not.toContain("service-key-order");
  });

  it("accepts security keys after the operational ones", () => {
    const source = [
      "name: qa",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    privileged: false",
      "    read_only: true",
      "    cap_drop:",
      "      - ALL",
      "    security_opt:",
      "      - no-new-privileges:true",
      "",
    ].join("\n");
    expect(ruleIds(source)).not.toContain("service-key-order");
  });

  it("accepts develop at the end of a service", () => {
    const source = [
      "name: qa",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    env_file:",
      "      - .env",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    develop:",
      "      watch:",
      "        - action: sync",
      "          path: ./src",
      "          target: /app/src",
      "",
    ].join("\n");
    expect(ruleIds(source)).not.toContain("service-key-order");
  });

  it("still reports a genuinely misplaced key", () => {
    const source = [
      "name: qa",
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:8080:80"',
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ruleIds(source)).toContain("service-key-order");
  });

  it("puts networks before volumes at the top level", () => {
    const ordered = [
      "name: qa",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "networks:",
      "  back: {}",
      "volumes:",
      "  data: {}",
      "",
    ].join("\n");
    expect(ruleIds(ordered)).not.toContain("top-level-order");
  });
});

describe("obsolete version field", () => {
  const withVersion = [
    "name: qa",
    'version: "3.8"',
    "services:",
    "  web:",
    "    image: nginx:1.27",
    '    healthcheck: { test: ["CMD", "true"] }',
    "",
  ].join("\n");

  it("asks for removal without also asking to reorder around it", () => {
    expect(ruleIds(withVersion)).toEqual(["no-version-field"]);
  });

  it("does not order a value-less version either", () => {
    const source = [
      "name: qa",
      "version:",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(messagesFor(source, "top-level-order")).toEqual([]);
    expect(messagesFor(source, "no-version-field")).toHaveLength(1);
  });

  it("leaves a kept version in place when the rule is disabled", () => {
    const off = resolveConfig({ rules: { "no-version-field": "off" } });
    const outcome = lintAndFix(
      [
        'version: "3.8"',
        "volumes:",
        "  data: {}",
        "services:",
        "  web:",
        "    image: nginx:1.27",
        '    healthcheck: { test: ["CMD", "true"] }',
        "",
      ].join("\n"),
      "compose.yaml",
      allRules,
      off,
    );
    // The ordering fix runs, but `version` keeps its line.
    expect(outcome.source.split("\n")[0]).toBe('version: "3.8"');
    expect(outcome.source.indexOf("services:")).toBeLessThan(
      outcome.source.indexOf("volumes:"),
    );
  });
});
