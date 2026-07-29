import { describe, expect, it } from "vitest";
import {
  countDiagnostics,
  describeError,
  EXIT_OK,
  EXIT_PROBLEMS,
  NO_WARNING_LIMIT,
  parseMaxWarnings,
  resolveExitCode,
} from "../src/cli/exit.js";
import type { LintResult } from "../src/core/types.js";

function result(severities: Array<"error" | "warn">): LintResult {
  return {
    filePath: "compose.yaml",
    fixed: false,
    diagnostics: severities.map((severity, index) => ({
      ruleId: `rule-${index}`,
      severity,
      message: "problem",
      range: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
      },
    })),
  };
}

describe("parseMaxWarnings", () => {
  it("defaults to no limit", () => {
    expect(parseMaxWarnings(undefined)).toEqual({ value: NO_WARNING_LIMIT });
    expect(parseMaxWarnings("")).toEqual({ value: NO_WARNING_LIMIT });
  });

  it("accepts zero and positive integers", () => {
    expect(parseMaxWarnings("0")).toEqual({ value: 0 });
    expect(parseMaxWarnings("25")).toEqual({ value: 25 });
  });

  it("accepts -1 as an explicit opt out", () => {
    expect(parseMaxWarnings("-1")).toEqual({ value: NO_WARNING_LIMIT });
  });

  it("rejects non-integers and values below -1", () => {
    for (const raw of ["abc", "1.5", "-2", "NaN"]) {
      const parsed = parseMaxWarnings(raw);
      expect(parsed.value).toBe(NO_WARNING_LIMIT);
      expect(parsed.error).toContain("Invalid --max-warnings");
    }
  });
});

describe("countDiagnostics", () => {
  it("counts errors and warnings across files", () => {
    const counts = countDiagnostics([
      result(["error", "warn", "warn"]),
      result(["warn"]),
    ]);
    expect(counts).toEqual({ errors: 1, warnings: 3 });
  });

  it("returns zeroes for clean results", () => {
    expect(countDiagnostics([result([])])).toEqual({ errors: 0, warnings: 0 });
  });
});

describe("describeError", () => {
  it("uses the first line of an error message", () => {
    const error = new Error("EACCES: permission denied\n    at open (fs.js:1)");
    expect(describeError(error)).toBe("EACCES: permission denied");
  });

  it("stringifies non-errors", () => {
    expect(describeError("boom")).toBe("boom");
    expect(describeError(42)).toBe("42");
  });
});

describe("resolveExitCode", () => {
  it("passes a clean run", () => {
    expect(
      resolveExitCode({ errors: 0, warnings: 0 }, NO_WARNING_LIMIT),
    ).toEqual({ code: EXIT_OK });
  });

  it("fails on any error regardless of the limit", () => {
    expect(resolveExitCode({ errors: 1, warnings: 0 }, 10).code).toBe(
      EXIT_PROBLEMS,
    );
  });

  it("ignores warnings when no limit is set", () => {
    expect(
      resolveExitCode({ errors: 0, warnings: 99 }, NO_WARNING_LIMIT).code,
    ).toBe(EXIT_OK);
  });

  it("passes when warnings are within the limit", () => {
    expect(resolveExitCode({ errors: 0, warnings: 5 }, 5).code).toBe(EXIT_OK);
  });

  it("fails when warnings exceed the limit", () => {
    const decision = resolveExitCode({ errors: 0, warnings: 6 }, 5);
    expect(decision.code).toBe(EXIT_PROBLEMS);
    expect(decision.message).toBe(
      "6 warnings exceed the --max-warnings limit of 5.",
    );
  });

  it("fails on a single warning with a limit of zero", () => {
    const decision = resolveExitCode({ errors: 0, warnings: 1 }, 0);
    expect(decision.code).toBe(EXIT_PROBLEMS);
    expect(decision.message).toBe(
      "1 warning exceeds the --max-warnings limit of 0.",
    );
  });
});
