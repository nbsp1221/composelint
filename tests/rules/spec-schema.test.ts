import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/loader.js";
import { lintSource } from "../../src/core/linter.js";
import { allRules } from "../../src/rules/index.js";
import {
  normalizeSchemaErrors,
  pointerToPath,
} from "../../src/rules/spec/schema-errors.js";

const config = resolveConfig({});

function lint(source: string) {
  return lintSource(source, "compose.yaml", allRules, config);
}

function schemaDiagnostics(source: string) {
  return lint(source).result.diagnostics.filter(
    (d) => d.ruleId === "spec-schema",
  );
}

function schemaMessages(source: string): string[] {
  return schemaDiagnostics(source).map((d) => d.message);
}

const VALID = [
  "name: ok",
  "services:",
  "  web:",
  "    image: nginx:1.27",
  "    ports:",
  '      - "127.0.0.1:8080:80"',
  "    healthcheck:",
  '      test: ["CMD", "true"]',
  "networks:",
  "  back:",
  "    driver: bridge",
  "",
].join("\n");

describe("spec-schema metadata", () => {
  it("is registered as a spec rule that defaults to error", () => {
    const rule = allRules.find((r) => r.meta.name === "spec-schema");
    expect(rule).toBeDefined();
    expect(rule?.meta.category).toBe("spec");
    expect(rule?.meta.defaultSeverity).toBe("error");
    expect(rule?.meta.fixable).toBe(false);
  });

  it("reports at error severity by default", () => {
    const found = schemaDiagnostics(
      "services:\n  web:\n    image: nginx:1.27\n    ports: true\n",
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
  });
});

describe("value type validation", () => {
  it("rejects a scalar where a list is required", () => {
    expect(
      schemaMessages(
        "services:\n  web:\n    image: nginx:1.27\n    ports: true\n",
      ),
    ).toEqual(['Service "web": "ports" must be an array']);
  });

  it("rejects a list where a mapping is required", () => {
    const messages = schemaMessages(
      "services:\n  web:\n    image: nginx:1.27\n    healthcheck:\n      - test\n",
    );
    expect(messages).toEqual([
      'Service "web": "healthcheck" must be a mapping',
    ]);
  });

  it("rejects a null service definition", () => {
    expect(schemaMessages("services:\n  web:\n")).toEqual([
      'Service "web": the definition must be a mapping',
    ]);
  });

  it("rejects a document that is not a mapping", () => {
    const messages = schemaMessages("- a\n- b\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("A Compose file must be a mapping");
  });

  it("accepts a valid file", () => {
    expect(schemaMessages(VALID)).toEqual([]);
  });
});

describe("unknown keys at every level", () => {
  it("reports unknown top-level keys", () => {
    expect(
      schemaMessages(
        "services:\n  web:\n    image: nginx:1.27\nfoobar: true\n",
      ),
    ).toEqual([
      'Unknown top-level key "foobar" is not part of the Compose Specification',
    ]);
  });

  it("reports unknown service keys", () => {
    expect(
      schemaMessages(
        "services:\n  web:\n    image: nginx:1.27\n    typo_key: yes\n",
      ),
    ).toEqual([
      'Service "web": unknown key "typo_key" is not part of the Compose Specification',
    ]);
  });

  it("reports unknown keys inside networks, volumes, secrets and configs", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "networks:",
      "  back:",
      "    drivr: bridge",
      "volumes:",
      "  data:",
      "    drivr: local",
      "secrets:",
      "  s1:",
      "    fil: ./secret.txt",
      "configs:",
      "  c1:",
      "    fiile: ./config.txt",
      "",
    ].join("\n");
    expect(schemaMessages(source)).toEqual([
      'Network "back": unknown key "drivr" is not part of the Compose Specification',
      'Volume "data": unknown key "drivr" is not part of the Compose Specification',
      'Secret "s1": unknown key "fil" is not part of the Compose Specification',
      'Config "c1": unknown key "fiile" is not part of the Compose Specification',
    ]);
  });

  it("reports unknown keys nested inside a service", () => {
    expect(
      schemaMessages(
        "services:\n  web:\n    image: nginx:1.27\n    deploy:\n      replcas: 2\n",
      ),
    ).toEqual([
      'Service "web": unknown key "replcas" in "deploy" is not part of the Compose Specification',
    ]);
  });

  it("accepts x- extension fields anywhere", () => {
    const source = [
      "x-shared: 1",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    x-custom: hello",
      "networks:",
      "  back:",
      "    x-net: true",
      "",
    ].join("\n");
    expect(schemaMessages(source)).toEqual([]);
  });
});

describe("diagnostic positions", () => {
  it("points at the offending value", () => {
    const found = schemaDiagnostics(
      "services:\n  web:\n    image: nginx:1.27\n    ports: true\n",
    );
    expect(found[0].range.start).toEqual({ line: 4, column: 12 });
  });

  it("points at the unknown key itself", () => {
    const found = schemaDiagnostics(
      "services:\n  web:\n    image: nginx:1.27\n    typo_key: yes\n",
    );
    expect(found[0].range.start).toEqual({ line: 4, column: 5 });
  });
});

describe("false positive mitigation", () => {
  it("resolves anchors and merge keys before validating", () => {
    const source = [
      "x-common: &common",
      "  restart: unless-stopped",
      "services:",
      "  web:",
      "    <<: *common",
      "    image: nginx:1.27",
      "",
    ].join("\n");
    expect(schemaMessages(source)).toEqual([]);
  });

  // biome-ignore-start lint/suspicious/noTemplateCurlyInString: these are Compose interpolation literals, not JS templates
  it("accepts interpolated values in typed fields", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    read_only: ${READ_ONLY}",
      "    deploy:",
      "      replicas: ${REPLICAS}",
      "    environment:",
      "      KEY: ${VALUE}",
      "",
    ].join("\n");
    expect(schemaMessages(source)).toEqual([]);
  });

  it("accepts interpolated keys", () => {
    expect(
      schemaMessages("services:\n  ${SERVICE}:\n    image: nginx:1.27\n"),
    ).toEqual([]);
  });
  // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end of Compose interpolation fixtures

  it("ignores values behind !reset and !override tags", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    ports: !reset null",
      '    command: !override ["true"]',
      "",
    ].join("\n");
    expect(schemaMessages(source)).toEqual([]);
  });
});

describe("noise reduction", () => {
  it("collapses a oneOf branch explosion into one diagnostic", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    ports:",
      "      - targt: 80",
      "",
    ].join("\n");
    const messages = schemaMessages(source);
    expect(messages).toEqual([
      'Service "web": unknown key "targt" in "ports[0]" is not part of the Compose Specification',
    ]);
  });

  it("merges type alternatives into a single message", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    ports:",
      "      - true",
      "",
    ].join("\n");
    const messages = schemaMessages(source);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('"ports[0]" must be');
    expect(messages[0]).toContain("a number");
    expect(messages[0]).toContain("a string");
  });
});

describe("configuration and suppression", () => {
  it("can be turned off through configuration", () => {
    const off = resolveConfig({ rules: { "spec-schema": "off" } });
    const output = lintSource(
      "services:\n  web:\n    ports: true\n",
      "compose.yaml",
      allRules,
      off,
    );
    expect(output.result.diagnostics.map((d) => d.ruleId)).not.toContain(
      "spec-schema",
    );
  });

  it("can be lowered to a warning", () => {
    const warn = resolveConfig({ rules: { "spec-schema": "warn" } });
    const output = lintSource(
      "services:\n  web:\n    image: nginx:1.27\n    ports: true\n",
      "compose.yaml",
      allRules,
      warn,
    );
    const found = output.result.diagnostics.filter(
      (d) => d.ruleId === "spec-schema",
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warn");
  });

  it("honours suppression comments", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    ports: true  # composelint-disable-line spec-schema",
      "",
    ].join("\n");
    expect(schemaMessages(source)).toEqual([]);
  });
});

describe("vendored schema", () => {
  const schemaUrl = new URL("../../schemas/compose-spec.json", import.meta.url);
  const metaUrl = new URL(
    "../../schemas/compose-spec.meta.json",
    import.meta.url,
  );

  it("matches the checksum recorded at vendoring time", () => {
    const raw = readFileSync(schemaUrl);
    const meta = JSON.parse(readFileSync(metaUrl, "utf-8")) as {
      sha256: string;
      bytes: number;
      license: string;
      upstreamCommit: string;
    };
    expect(createHash("sha256").update(raw).digest("hex")).toBe(meta.sha256);
    expect(raw.byteLength).toBe(meta.bytes);
    expect(meta.license).toBe("Apache-2.0");
    expect(meta.upstreamCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is the draft 2020-12 Compose Specification schema", () => {
    const schema = JSON.parse(readFileSync(schemaUrl, "utf-8")) as {
      $schema: string;
      additionalProperties: boolean;
      properties: Record<string, unknown>;
      $defs: Record<string, unknown>;
    };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toContain("services");
    expect(Object.keys(schema.$defs)).toEqual(
      expect.arrayContaining([
        "service",
        "network",
        "volume",
        "secret",
        "config",
      ]),
    );
  });
});

describe("error normalization helpers", () => {
  it("parses JSON pointers into paths with numeric indices", () => {
    expect(pointerToPath("")).toEqual([]);
    expect(pointerToPath("/services/web/ports/0")).toEqual([
      "services",
      "web",
      "ports",
      0,
    ]);
  });

  it("returns nothing for an empty error list", () => {
    expect(normalizeSchemaErrors(null)).toEqual([]);
    expect(normalizeSchemaErrors([])).toEqual([]);
  });
});
