export type Severity = "error" | "warn" | "off";

export type RuleCategory = "spec" | "style" | "security" | "best-practice";

export interface SourcePosition {
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  range: SourceRange;
  fix?: Fix;
}

/** A replacement of `[start, end)` in the original source with `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface Fix {
  description: string;
  /** Edits to the original source; never empty. */
  edits: TextEdit[];
}

export interface LintResult {
  filePath: string;
  diagnostics: Diagnostic[];
  fixed: boolean;
}

/** One explicitly approved public host-port surface. */
export interface PublishedPortAllowance {
  service: string;
  /** Published host ports in `<port-or-range>/<protocol>` form. */
  published: string[];
  /** Human-readable context for reviewers; it does not affect matching. */
  reason?: string;
}

/** Types a rule option may take; validated when the configuration is read. */
export type RuleOptionType = "string[]" | "published-port-allowances";

export interface RuleMeta {
  /** The rule's identity, used in configuration, suppressions and output. */
  name: string;
  category: RuleCategory;
  description: string;
  fixable: boolean;
  defaultSeverity: Severity;
  /**
   * True when the rule can only be answered from a complete project. Such rules
   * are skipped for partial files (override files and included fragments),
   * where the missing piece lives in another file.
   */
  requiresFullProject?: boolean;
  /**
   * Options the rule accepts, by name. Anything else in the configuration is
   * reported instead of being silently ignored, and values of the wrong type are
   * dropped so rules never have to guess.
   */
  options?: Record<string, RuleOptionType>;
}

export interface ReportDescriptor {
  message: string;
  /** yaml AST node with a range property */
  node: { range?: [number, number, number] | null };
  /**
   * Produces edits to the original source, or null when this occurrence cannot
   * be fixed safely (for example inside a flow mapping written on one line).
   */
  fix?: () => TextEdit[] | null;
}

export interface RuleContext {
  document: import("./document.js").ComposeDocument;
  options: Record<string, unknown>;
  report: (descriptor: ReportDescriptor) => void;
}

export interface Rule {
  meta: RuleMeta;
  create: (context: RuleContext) => void;
}

export interface RuleConfig {
  severity: Severity;
  options: Record<string, unknown>;
}

export interface ResolvedConfig {
  rules: Map<string, RuleConfig>;
  /** Glob patterns of files to skip, in evaluation order. */
  exclude: string[];
  /**
   * Glob patterns of files that only carry part of a project (override files,
   * `include:` fragments). Rules marked `requiresFullProject` are skipped there.
   */
  partials: string[];
  /** Non-fatal problems found while resolving the configuration. */
  warnings: string[];
}
