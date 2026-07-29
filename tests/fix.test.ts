import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/loader.js";
import { lintAndFix, lintSource } from "../src/core/linter.js";
import {
  applyEdits,
  deleteEntryLines,
  reorderEntries,
} from "../src/core/text-edit.js";
import { allRules } from "../src/rules/index.js";

const config = resolveConfig({});

function fix(source: string) {
  return lintAndFix(source, "compose.yaml", allRules, config);
}

function diffLines(before: string, after: string): number[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const changed: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) changed.push(i + 1);
  }
  return changed;
}

describe("applyEdits", () => {
  it("applies non-overlapping edits in order", () => {
    const result = applyEdits("abcdef", [
      { start: 4, end: 5, text: "E" },
      { start: 0, end: 1, text: "A" },
    ]);
    expect(result.output).toBe("AbcdEf");
    expect(result.applied).toBe(2);
    expect(result.deferred).toBe(0);
  });

  it("defers overlapping edits instead of corrupting the source", () => {
    const result = applyEdits("abcdef", [
      { start: 0, end: 4, text: "X" },
      { start: 2, end: 5, text: "Y" },
    ]);
    expect(result.output).toBe("Xef");
    expect(result.applied).toBe(1);
    expect(result.deferred).toBe(1);
  });

  it("returns the source unchanged when there are no edits", () => {
    expect(applyEdits("abc", []).output).toBe("abc");
  });
});

describe("deleteEntryLines", () => {
  it("removes the whole line of an entry", () => {
    const source = "a: 1\nb: 2\nc: 3\n";
    const edits = deleteEntryLines(source, { keyStart: 5, valueEnd: 9 });
    expect(edits).not.toBeNull();
    expect(applyEdits(source, edits ?? []).output).toBe("a: 1\nc: 3\n");
  });
});

describe("reorderEntries", () => {
  it("returns null when the order matches the source", () => {
    const source = "a: 1\nb: 2\n";
    const edits = reorderEntries(
      source,
      [
        { keyStart: 0, valueEnd: 4 },
        { keyStart: 5, valueEnd: 9 },
      ],
      [0, 1],
    );
    expect(edits).toBeNull();
  });

  it("keeps a missing trailing newline missing", () => {
    const source = "a: 1\nb: 2";
    const edits = reorderEntries(
      source,
      [
        { keyStart: 0, valueEnd: 4 },
        { keyStart: 5, valueEnd: 9 },
      ],
      [1, 0],
    );
    expect(applyEdits(source, edits ?? []).output).toBe("b: 2\na: 1");
  });
});

describe("minimal diffs", () => {
  it("touches only the reordered lines", () => {
    const before = [
      "name: qa",
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:3000:3000"',
      "    image: nginx:1.27  # pinned on purpose",
      '    healthcheck: { test: ["CMD", "true"] }',
      "    environment:",
      '      LONG: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      "    labels:",
      "      - 'single.quoted=yes'",
      "",
    ].join("\n");

    const { source: after, changed } = fix(before);
    expect(changed).toBe(true);

    // Only the two-line image/ports swap moves; everything else is byte-identical.
    expect(after).toContain("    image: nginx:1.27  # pinned on purpose");
    expect(after).toContain('    healthcheck: { test: ["CMD", "true"] }');
    expect(after).toContain(
      '      LONG: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    );
    expect(after).toContain("      - 'single.quoted=yes'");
    expect(after.indexOf("image:")).toBeLessThan(after.indexOf("ports:"));
  });

  it("preserves a file header comment when removing version", () => {
    const before = [
      "# Deployment for the QA environment",
      'version: "3.8"',
      "name: qa",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      "",
    ].join("\n");

    const { source: after } = fix(before);
    expect(after.split("\n")[0]).toBe("# Deployment for the QA environment");
    expect(after).not.toContain("version:");
    expect(diffLines(before, after)).not.toContain(1);
  });

  it("keeps a comment with the key it documents", () => {
    const before = [
      "name: qa",
      "services:",
      "  web:",
      "    # published on the host network on purpose",
      "    ports:",
      '      - "3000:3000"',
      "    image: nginx:1.27",
      "",
    ].join("\n");

    const { source: after } = fix(before);
    const lines = after.split("\n");
    const commentIndex = lines.findIndex((line) =>
      line.includes("published on the host network"),
    );
    expect(lines[commentIndex + 1]).toBe("    ports:");
    expect(lines.indexOf("    image: nginx:1.27")).toBeLessThan(commentIndex);
  });

  it("preserves blank lines between entries", () => {
    const before = [
      "name: qa",
      "services:",
      "  web:",
      "    ports:",
      '      - "3000:3000"',
      "",
      "    image: nginx:1.27",
      "",
    ].join("\n");

    const { source: after } = fix(before);
    expect(after.split("\n").filter((line) => line === "").length).toBe(
      before.split("\n").filter((line) => line === "").length,
    );
    expect(after).toContain("    image: nginx:1.27");
  });

  it("leaves anchors and merge keys untouched", () => {
    const before = [
      "x-defaults: &defaults",
      "  restart: unless-stopped",
      "name: qa",
      "services:",
      "  web:",
      "    <<: *defaults",
      "    ports:",
      '      - "127.0.0.1:3000:3000"',
      "    image: nginx:1.27",
      "",
    ].join("\n");

    const { source: after } = fix(before);
    expect(after).toContain("x-defaults: &defaults");
    expect(after).toContain("    <<: *defaults");
    expect(after.indexOf("    image:")).toBeLessThan(
      after.indexOf("    ports:"),
    );
  });
});

describe("multi-pass fixing", () => {
  it("removes version and reorders in the same run", () => {
    const before = [
      'version: "3.8"',
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:3000:3000"',
      "    image: nginx:1.27",
      "name: qa",
      "",
    ].join("\n");

    const outcome = fix(before);
    expect(outcome.changed).toBe(true);
    expect(outcome.passes).toBeGreaterThan(1);
    expect(outcome.source).not.toContain("version:");
    expect(outcome.source.indexOf("name: qa")).toBeLessThan(
      outcome.source.indexOf("services:"),
    );
    expect(outcome.source.indexOf("    image:")).toBeLessThan(
      outcome.source.indexOf("    ports:"),
    );
  });

  it("is idempotent", () => {
    const before = [
      'version: "3.8"',
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:3000:3000"',
      "    image: nginx:1.27",
      "name: qa",
      "",
    ].join("\n");

    const first = fix(before);
    const second = fix(first.source);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(first.source);
  });

  it("leaves a clean file untouched", () => {
    const source = [
      "name: qa",
      "services:",
      "  web:",
      "    image: nginx:1.27",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    const outcome = fix(source);
    expect(outcome.changed).toBe(false);
    expect(outcome.source).toBe(source);
  });

  it("still parses after fixing", () => {
    const before = [
      'version: "3.8"',
      "volumes:",
      "  data: {}",
      "services:",
      "  web:",
      "    ports:",
      '      - "127.0.0.1:3000:3000"',
      "    image: nginx:1.27",
      "",
    ].join("\n");

    const outcome = fix(before);
    const relinted = lintSource(
      outcome.source,
      "compose.yaml",
      allRules,
      config,
    );
    expect(relinted.document.parseErrors).toEqual([]);
    expect(relinted.result.diagnostics.filter((d) => d.fix).length).toBe(0);
  });
});

describe("unfixable shapes", () => {
  it("does not offer a fix for a flow mapping service", () => {
    const source = [
      "name: qa",
      "services:",
      "  web: {ports: [], image: nginx:1.27}",
      "",
    ].join("\n");

    const output = lintSource(source, "compose.yaml", allRules, config);
    const orderDiagnostic = output.result.diagnostics.find(
      (d) => d.ruleId === "service-key-order",
    );
    expect(orderDiagnostic).toBeDefined();
    expect(orderDiagnostic?.fix).toBeUndefined();
    expect(fix(source).changed).toBe(false);
  });

  it("does not offer a fix for a flow mapping at the top level", () => {
    const source = '{version: "3.8", services: {}}\n';
    const output = lintSource(source, "compose.yaml", allRules, config);
    const versionDiagnostic = output.result.diagnostics.find(
      (d) => d.ruleId === "no-version-field",
    );
    expect(versionDiagnostic).toBeDefined();
    expect(versionDiagnostic?.fix).toBeUndefined();
  });
});

// The parser ends a block value at the *next token*, so a comment on the last
// line of a block pushes the reported range into the following entry — and for
// the last entry of a service, into the next service. Both cases used to make
// the whole mapping unfixable, which meant `--fix` silently did nothing to a
// diagnostic it had marked `[fixable]`.
describe("a comment on the last line of a block", () => {
  it("reorders a service whose nested block ends with a comment", () => {
    const source = [
      "name: qa",
      "services:",
      "  worker:",
      "    image: app:1.0",
      "    deploy:",
      "      resources:",
      "        limits:",
      "          memory: 2048M",
      "          # for GB, use '2Gi'",
      "    depends_on:",
      "      - db",
      "  db:",
      "    image: postgres:16",
      "",
    ].join("\n");

    const { source: fixed } = fix(source);
    const lines = fixed.split("\n");
    expect(lines.indexOf("    depends_on:")).toBeLessThan(
      lines.indexOf("    deploy:"),
    );
    // The comment stays with the value it documents.
    expect(fixed).toContain("          memory: 2048M\n          # for GB");
    // The service that follows is untouched.
    expect(fixed).toContain("  db:\n    image: postgres:16");
  });

  // Reduced from a real file (jitsi-meet). The last key of the first service
  // holds a nested mapping whose own last key has no value, and a comment
  // introduces the service that follows: the reported range then runs past the
  // comment into the next service, and rewriting that far duplicated its keys.
  // The whole pass was thrown away, so `--fix` changed nothing at all.
  it("does not pull the next service into the rewrite", () => {
    const source = [
      "services:",
      "    prosody:",
      "        volumes:",
      "            - DISABLE_POLLS",
      "        networks:",
      "            meet.jitsi:",
      "                aliases:",
      "",
      "    # Focus component",
      "    jicofo:",
      "        image: jitsi/jicofo:stable",
      "        restart: unless-stopped",
      "        read_only: true",
      "        tmpfs:",
      "            - /run:size=16M,mode=1750,exec",
      "        ports:",
      "            - '127.0.0.1:8888:8888'",
      "        volumes:",
      "            - ./jicofo:/config:Z",
      "        labels:",
      '            service: "jitsi-jicofo"',
      "        environment:",
      "            - AUTH_TYPE",
      "        depends_on:",
      "            - prosody",
      "        networks:",
      "            meet.jitsi:",
      "",
      "    # Video bridge",
      "networks:",
      "    meet.jitsi:",
      "",
    ].join("\n");

    const { source: fixed } = fix(source);
    const after = lintSource(fixed, "compose.yaml", allRules, config).result;

    expect(after.diagnostics.map((d) => d.ruleId)).not.toContain("parse-error");
    expect(
      after.diagnostics.filter((d) => d.ruleId === "service-key-order"),
    ).toHaveLength(0);
    // No key was copied from a neighbour and none was lost.
    expect(fixed.match(/^ {8}networks:/gm)).toHaveLength(2);
    expect(fixed.match(/^ {4}[a-z]+:$/gm)).toEqual([
      "    prosody:",
      "    jicofo:",
    ]);
    // Section comments still introduce what follows them.
    expect(fixed).toContain("    # Focus component\n    jicofo:");
    expect(fixed).toContain("    # Video bridge\nnetworks:");
  });
});
