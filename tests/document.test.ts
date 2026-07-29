import { describe, expect, it } from "vitest";
import { ComposeDocument } from "../src/core/document.js";
import { lint } from "./helpers.js";

describe("ComposeDocument", () => {
  it("parses a simple compose file", () => {
    const doc = new ComposeDocument(
      "services:\n  web:\n    image: nginx\n",
      "t.yaml",
    );
    expect(doc.root).not.toBeNull();
    expect(doc.getTopLevelKeys()).toEqual(["services"]);
    expect(doc.getMergedServiceNames()).toEqual(["web"]);
    expect(doc.getMergedServiceKeys("web")).toEqual(["image"]);
  });

  it("handles empty input", () => {
    const doc = new ComposeDocument("", "t.yaml");
    expect(doc.root).toBeNull();
    expect(doc.getTopLevelKeys()).toEqual([]);
  });

  it("converts offsets to positions", () => {
    const doc = new ComposeDocument("a: 1\nb: 2\n", "t.yaml");
    expect(doc.offsetToPosition(0)).toEqual({ line: 1, column: 1 });
    expect(doc.offsetToPosition(5)).toEqual({ line: 2, column: 1 });
  });
});

describe("YAML merge keys", () => {
  it("treats << as position independent instead of a symbol", () => {
    const result = lint(
      [
        "x-defaults: &defaults",
        "  restart: unless-stopped",
        "services:",
        "  web:",
        "    <<: *defaults",
        "    image: nginx:1",
        '    healthcheck: { test: ["CMD", "true"] }',
        "",
      ].join("\n"),
    );
    const messages = result.diagnostics.map((d) => d.message).join("\n");
    expect(messages).not.toContain("Symbol(<<)");
    expect(result.diagnostics.map((d) => d.ruleId)).not.toContain(
      "service-key-order",
    );
  });

  it("resolves merged values so other rules see them", () => {
    const document = new ComposeDocument(
      [
        "x-defaults: &defaults",
        "  image: nginx:1",
        "services:",
        "  web:",
        "    <<: *defaults",
        "",
      ].join("\n"),
      "compose.yaml",
    );
    const data = document.toJS() as {
      services: { web: { image: string } };
    };
    expect(data.services.web.image).toBe("nginx:1");
  });
});

// An alias with no anchor in front of it parses cleanly and only fails while
// the document is being resolved. Before this was handled, the throw escaped
// through the rule that asked for the data and took the whole run with it,
// discarding the diagnostics of every other file.
describe("a document that resolves to nothing", () => {
  const broken = [
    "name: broken",
    "services:",
    "  web:",
    "    image: nginx:1.27",
    "    logging: *missing",
    "",
  ].join("\n");

  it("reports an unresolvable alias as a parse error", () => {
    const { diagnostics } = lint(broken);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.ruleId).toBe("parse-error");
    expect(diagnostics[0]?.message).toContain("Unresolved alias");
  });

  it("points at the alias rather than the top of the file", () => {
    const [diagnostic] = lint(broken).diagnostics;
    expect(diagnostic?.range.start).toEqual({ line: 5, column: 14 });
  });

  it("keeps the message on one line", () => {
    expect(lint(broken).diagnostics[0]?.message).not.toContain("\n");
  });

  it("also catches an anchor defined after the alias", () => {
    const source = [
      "name: late",
      "services:",
      "  web:",
      "    logging: *later",
      "    image: nginx:1.27",
      "x-logging: &later",
      "  driver: json-file",
      "",
    ].join("\n");
    const { diagnostics } = lint(source);
    expect(diagnostics.map((d) => d.ruleId)).toEqual(["parse-error"]);
    expect(diagnostics[0]?.range.start.line).toBe(4);
  });

  it("exposes no data instead of throwing", () => {
    const document = new ComposeDocument(broken, "t.yaml");
    expect(document.toJS()).toBeNull();
    expect(document.getMergedServiceNames()).toEqual([]);
  });
});
