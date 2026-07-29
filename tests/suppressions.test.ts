import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/loader.js";
import { lintAndFix, lintSource } from "../src/core/linter.js";
import { createSuppressions } from "../src/core/suppressions.js";
import { allRules } from "../src/rules/index.js";

const config = resolveConfig({});

function lint(source: string) {
  return lintSource(source, "compose.yaml", allRules, config);
}

function ids(source: string): string[] {
  return lint(source).result.diagnostics.map((d) => d.ruleId);
}

function messages(source: string): string[] {
  return lint(source).result.diagnostics.map((d) => d.message);
}

const HEALTHY_TAIL = '    healthcheck: { test: ["CMD", "true"] }\n';

describe("directive parsing", () => {
  it("parses the hyphenated form with rules and a reason", () => {
    const { directives } = createSuppressions(
      "# composelint-disable-file no-unbound-ports no-privileged -- dev only\nname: x\n",
      allRules,
    );
    expect(directives).toHaveLength(1);
    expect(directives[0]).toMatchObject({
      kind: "disable-file",
      ruleIds: ["no-unbound-ports", "no-privileged"],
      reason: "dev only",
      commentLine: 1,
    });
  });

  it("accepts the space-separated form, rule: prefixes and commas", () => {
    const { directives } = createSuppressions(
      "# composelint disable-file rule:no-unbound-ports, rule:no-privileged\nname: x\n",
      allRules,
    );
    expect(directives[0].ruleIds).toEqual([
      "no-unbound-ports",
      "no-privileged",
    ]);
  });

  it("treats a directive without rules as covering every rule", () => {
    const { directives } = createSuppressions(
      "# composelint-disable-file\nname: x\n",
      allRules,
    );
    expect(directives[0].ruleIds).toBeNull();
  });

  it("records unknown rule keys", () => {
    const { directives } = createSuppressions(
      "# composelint-disable-file image-require-tag no-such-rule\nname: x\n",
      allRules,
    );
    expect(directives[0].ruleIds).toEqual(["image-require-tag"]);
    expect(directives[0].unknownRuleKeys).toEqual(["no-such-rule"]);
  });

  it("ignores comments that are not directives", () => {
    const { directives } = createSuppressions(
      "# just a comment\n# composelint is nice\nname: x\n",
      allRules,
    );
    expect(directives).toHaveLength(0);
  });

  it("ignores lookalikes inside quoted scalars and block scalars", () => {
    const source = [
      "services:",
      "  web:",
      '    command: echo "# composelint-disable-file image-require-tag"',
      "    entrypoint: |",
      "      # composelint-disable-line image-require-tag",
      "      echo hi",
      "    image: nginx",
      "",
    ].join("\n");
    expect(createSuppressions(source, allRules).directives).toHaveLength(0);
    expect(ids(source)).toContain("image-require-tag");
  });
});

describe("disable-line", () => {
  it("suppresses the line it trails", () => {
    const source = `services:\n  web:\n    image: nginx  # composelint-disable-line image-require-tag\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("accepts a rule name instead of an id", () => {
    const source = `services:\n  web:\n    image: nginx  # composelint-disable-line image-require-tag\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("suppresses every rule when no rule is named", () => {
    const source = `services:\n  web:\n    image: nginx  # composelint-disable-line\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("does not leak to other lines", () => {
    const source = [
      "services:",
      "  a:",
      "    image: nginx  # composelint-disable-line image-require-tag",
      '    healthcheck: { test: ["CMD", "true"] }',
      "  b:",
      "    image: redis",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    const found = lint(source).result.diagnostics.filter(
      (d) => d.ruleId === "image-require-tag",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Service "b"');
  });

  it("applies to the next content line when it stands alone", () => {
    const source = `services:\n  web:\n    # composelint-disable-line image-require-tag\n    image: nginx\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("image-require-tag");
  });
});

describe("disable-next-line", () => {
  it("suppresses the following line", () => {
    const source = `services:\n  web:\n    # composelint-disable-next-line image-require-tag\n    image: nginx\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("skips blank and comment lines when resolving the target", () => {
    const source = `services:\n  web:\n    # composelint-disable-next-line image-require-tag\n\n    # unrelated note\n    image: nginx\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("covers diagnostics reported inside the indented block", () => {
    const source = [
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "    # composelint-disable-next-line no-unbound-ports",
      "    ports:",
      '      - "3000:3000"',
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ids(source)).not.toContain("no-unbound-ports");
  });

  it("stops at the end of the indented block", () => {
    const source = [
      "services:",
      "  a:",
      "    # composelint-disable-next-line no-unbound-ports",
      "    ports:",
      '      - "3000:3000"',
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "  b:",
      "    image: redis:7",
      "    ports:",
      '      - "6379:6379"',
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    const found = lint(source).result.diagnostics.filter(
      (d) => d.ruleId === "no-unbound-ports",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Service "b"');
  });
});

describe("disable-file", () => {
  it("suppresses the named rules everywhere in the file", () => {
    const source = [
      "# composelint-disable-file image-require-tag",
      "services:",
      "  a:",
      "    image: nginx",
      '    healthcheck: { test: ["CMD", "true"] }',
      "  b:",
      "    image: redis",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("suppresses every rule when no rule is named", () => {
    const source = [
      "# composelint-disable-file",
      'version: "3.8"',
      "services:",
      "  web:",
      "    privileged: true",
      "    image: nginx",
      "",
    ].join("\n");
    expect(ids(source)).toEqual([]);
  });
});

describe("disable / enable ranges", () => {
  it("suppresses between the two directives only", () => {
    const source = [
      "services:",
      "  # composelint-disable image-require-tag",
      "  a:",
      "    image: nginx",
      '    healthcheck: { test: ["CMD", "true"] }',
      "  # composelint-enable image-require-tag",
      "  b:",
      "    image: redis",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    const found = lint(source).result.diagnostics.filter(
      (d) => d.ruleId === "image-require-tag",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Service "b"');
  });

  it("runs to the end of the file when never enabled again", () => {
    const source = [
      "services:",
      "  # composelint-disable image-require-tag",
      "  a:",
      "    image: nginx",
      '    healthcheck: { test: ["CMD", "true"] }',
      "  b:",
      "    image: redis",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ids(source)).not.toContain("image-require-tag");
  });

  it("closes every open rule when enable names none", () => {
    const source = [
      "services:",
      "  # composelint-disable image-require-tag",
      "  a:",
      "    image: nginx",
      '    healthcheck: { test: ["CMD", "true"] }',
      "  # composelint-enable",
      "  b:",
      "    image: redis",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    const found = lint(source).result.diagnostics.filter(
      (d) => d.ruleId === "image-require-tag",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('Service "b"');
  });
});

describe("suppression problems", () => {
  it("reports unknown rules in a directive", () => {
    const source = `services:\n  web:\n    image: nginx:1.27  # composelint-disable-line no-such-rule\n${HEALTHY_TAIL}`;
    expect(messages(source)).toContain(
      'Unknown rule "no-such-rule" in suppression comment — it suppresses nothing',
    );
  });

  it("reports an unused directive", () => {
    const source = `services:\n  web:\n    image: nginx:1.27  # composelint-disable-line image-require-tag\n${HEALTHY_TAIL}`;
    const problems = lint(source).result.diagnostics.filter(
      (d) => d.ruleId === "suppression",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("Unused suppression comment");
    expect(problems[0].severity).toBe("warn");
  });

  it("does not report a directive that suppressed something", () => {
    const source = `services:\n  web:\n    image: nginx  # composelint-disable-line image-require-tag\n${HEALTHY_TAIL}`;
    expect(ids(source)).not.toContain("suppression");
  });

  it("reports an enable without a matching disable", () => {
    const source = `services:\n  web:\n    image: nginx:1.27\n${HEALTHY_TAIL}# composelint-enable image-require-tag\n`;
    expect(messages(source).join("\n")).toContain(
      'has no matching "composelint-disable"',
    );
  });

  it("does not add an unused report when all rule keys were unknown", () => {
    const source = `services:\n  web:\n    image: nginx:1.27  # composelint-disable-line no-such-rule\n${HEALTHY_TAIL}`;
    const problems = lint(source).result.diagnostics.filter(
      (d) => d.ruleId === "suppression",
    );
    expect(problems).toHaveLength(1);
  });
});

describe("interaction with other features", () => {
  it("never applies the fix of a suppressed diagnostic", () => {
    const source = `version: "3.8"  # composelint-disable-line no-version-field\nname: x\nservices:\n  web:\n    image: nginx:1.27\n${HEALTHY_TAIL}`;
    const outcome = lintAndFix(source, "compose.yaml", allRules, config);
    expect(outcome.changed).toBe(false);
    expect(outcome.appliedCount).toBe(0);
    expect(outcome.source).toContain('version: "3.8"');
  });

  it("cannot suppress YAML parse errors", () => {
    const source =
      "# composelint-disable-file\nservices:\n  web:\n  image: [unclosed\n";
    expect(ids(source)).toContain("parse-error");
  });
});

// The tool is called composelint, but it lints files called docker-compose.yaml,
// so `compose-lint-disable-line` is the natural thing to type. A comment that is
// not recognised as a directive would otherwise be an ordinary comment, and the
// rule it meant to suppress would still be reported with no hint why.
describe("a directive that misspells the tool name", () => {
  function problems(comment: string): string[] {
    const source = [
      "name: qa",
      "services:",
      "  runner:",
      "    image: docker:27-dind",
      `    privileged: true  # ${comment} no-privileged -- dind needs it`,
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    return lint(source)
      .result.diagnostics.filter((d) => d.ruleId === "suppression")
      .map((d) => d.message);
  }

  it("reports the hyphenated spelling", () => {
    expect(problems("compose-lint-disable-line")).toEqual([
      'Suppression comment "# compose-lint-disable-line" is not recognised — write "composelint-disable-line"',
    ]);
  });

  it("still reports the rule the comment tried to suppress", () => {
    const source = [
      "name: qa",
      "services:",
      "  runner:",
      "    image: docker:27-dind",
      "    privileged: true  # compose-lint-disable-line no-privileged",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ids(source)).toContain("no-privileged");
  });

  it.each([
    "compose_lint-disable-line",
    "compose lint disable-line",
    "composelinter-disable-line",
  ])("reports %s", (comment) => {
    expect(problems(comment)).toHaveLength(1);
  });

  it("says nothing about an ordinary comment", () => {
    expect(problems("keep privileged")).toEqual([]);
    expect(problems("see docs/rules/no-privileged.md")).toEqual([]);
  });

  it("accepts the correct spelling silently", () => {
    expect(problems("composelint-disable-line")).toEqual([]);
  });
});
