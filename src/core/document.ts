import {
  type Document,
  isAlias,
  isMap,
  isScalar,
  type Pair,
  parseDocument,
  visit,
  type YAMLMap,
} from "yaml";
import type { SourcePosition, SourceRange } from "./types.js";

/** A node that a diagnostic can point at. */
export interface RangedNode {
  range?: [number, number, number] | null;
}

export interface ServiceReportTarget {
  node: RangedNode;
  /** True when the reported value is not written in the service itself. */
  inherited: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRange(value: unknown): value is RangedNode {
  return typeof value === "object" && value !== null && "range" in value;
}

/**
 * The service an `extends` entry points at. `file` is set when the definition
 * lives in another document, which this linter does not read.
 */
function extendsTarget(
  service: Record<string, unknown>,
): { service?: string; file?: string } | null {
  const value = service.extends;
  if (typeof value === "string") return { service: value };
  if (!isPlainRecord(value)) return null;

  return {
    service: typeof value.service === "string" ? value.service : undefined,
    file: typeof value.file === "string" ? value.file : undefined,
  };
}

export class ComposeDocument {
  readonly doc: Document;
  readonly source: string;
  readonly filePath: string;

  /** Memoized `toJS()` result; rules ask for merged data repeatedly. */
  #js: { value: unknown } | undefined;

  /**
   * Set when the document parses but cannot be turned into data, which in
   * practice means an alias with no anchor in front of it. The parser only
   * discovers this while resolving, so it surfaces as a thrown error rather
   * than an entry in `doc.errors`.
   */
  #dataError: unknown;

  /** Services with `extends` chains resolved, built on first use. */
  #resolved: Map<string, Record<string, unknown>> | undefined;

  /** Services whose definition partly lives in another file. */
  readonly #externalExtends = new Set<string>();

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
    // `merge` resolves YAML merge keys (`<<: *anchor`), which Compose supports
    // and which schema validation needs to see as plain data.
    this.doc = parseDocument(source, { keepSourceTokens: true, merge: true });
  }

  /**
   * The document as plain JavaScript data, with anchors and merge keys
   * resolved. Alias expansion is unlimited because Compose files legitimately
   * reuse one anchor across many services.
   */
  toJS(): unknown {
    if (this.#js === undefined) {
      try {
        this.#js = { value: this.doc.toJS({ maxAliasCount: -1 }) };
      } catch (error) {
        // Reported through `parseProblems`, so rules never run on a document
        // that has no data. Returning null here keeps every other caller — the
        // fix loop included — from having to handle a throw.
        this.#dataError = error;
        this.#js = { value: null };
      }
    }
    return this.#js.value;
  }

  /**
   * Where the first alias with this name appears, so an unresolvable reference
   * is reported on its own line instead of at the top of the file.
   */
  #aliasPosition(name: string): SourcePosition | undefined {
    let position: SourcePosition | undefined;
    visit(this.doc, {
      Alias: (_key, node) => {
        if (position !== undefined || node.source !== name) return;
        const start = node.range?.[0];
        if (start !== undefined) position = this.offsetToPosition(start);
      },
    });
    return position;
  }

  /** Services as plain data, so `<<: *anchor` values are visible to rules. */
  getMergedServices(): Record<string, unknown> | null {
    const data = this.toJS();
    if (!isPlainRecord(data)) return null;
    const services = data.services;
    return isPlainRecord(services) ? services : null;
  }

  /** Service names from the merged data, in document order. */
  getMergedServiceNames(): string[] {
    const services = this.getMergedServices();
    return services ? Object.keys(services) : [];
  }

  /**
   * One service as plain data: everything it inherits through merge keys plus
   * anything it takes from a service it `extends` in this same file. Keys
   * written in the service itself win, which is what Compose does.
   */
  getMergedService(name: string): Record<string, unknown> | null {
    return this.#resolvedServices().get(name) ?? null;
  }

  /**
   * True when the service extends a definition this document cannot see, so
   * rules that ask whether a key is missing have no answer.
   */
  hasExternalExtends(name: string): boolean {
    this.#resolvedServices();
    return this.#externalExtends.has(name);
  }

  /** Resolves `extends` chains within this document, once per document. */
  #resolvedServices(): Map<string, Record<string, unknown>> {
    if (this.#resolved) return this.#resolved;

    const resolved = new Map<string, Record<string, unknown>>();
    this.#resolved = resolved;

    const services = this.getMergedServices();
    if (!services) return resolved;

    const resolve = (
      name: string,
      seen: ReadonlySet<string>,
    ): Record<string, unknown> | null => {
      const raw = services[name];
      if (!isPlainRecord(raw)) return null;

      const target = extendsTarget(raw);
      if (target === null) return raw;

      if (target.file !== undefined) {
        this.#externalExtends.add(name);
        return raw;
      }

      // A cycle is invalid Compose; stop rather than recurse forever.
      if (target.service === undefined || seen.has(target.service)) return raw;

      const base = resolve(target.service, new Set([...seen, name]));
      if (this.#externalExtends.has(target.service)) {
        this.#externalExtends.add(name);
      }
      return base ? { ...base, ...raw } : raw;
    };

    for (const name of Object.keys(services)) {
      const service = resolve(name, new Set());
      if (service) resolved.set(name, service);
    }

    return resolved;
  }

  /** The effective value of a service key, inherited values included. */
  getMergedServiceValue(name: string, key: string): unknown {
    return this.getMergedService(name)?.[key];
  }

  /** The effective keys of a service, inherited keys included. */
  getMergedServiceKeys(name: string): string[] {
    const service = this.getMergedService(name);
    return service ? Object.keys(service) : [];
  }

  /**
   * The node that brings inherited keys into a service: the alias itself when
   * there is exactly one (`<<: *base`, or `web: *base`), otherwise the `<<` key,
   * because picking one alias out of `<<: [*a, *b]` would be arbitrary.
   */
  getServiceMergeNode(name: string): unknown {
    const services = this.getServicesMap();
    if (!services) return undefined;

    const servicePair = services.items.find(
      (pair) => this.pairKeyName(pair) === name,
    );
    if (!servicePair) return undefined;

    // `web: *base` — the whole service is an alias.
    if (isAlias(servicePair.value)) return servicePair.value;

    const svcMap = isMap(servicePair.value) ? servicePair.value : null;
    if (!svcMap) return servicePair.key;

    const mergePair = svcMap.items.find(
      (pair) => this.pairKeyName(pair) === "<<",
    );
    if (mergePair) {
      // A single alias points at one anchor; a list of them does not, so the
      // `<<` key is the honest location.
      return isAlias(mergePair.value) ? mergePair.value : mergePair.key;
    }

    const extendsPair = svcMap.items.find(
      (pair) => this.pairKeyName(pair) === "extends",
    );
    return extendsPair?.key;
  }

  /**
   * Where to report a diagnostic about `path` inside a service.
   *
   * Directly written values are reported on their own node. Inherited values
   * have no node inside the service, so they are reported on whatever merged
   * them in, and callers mark the message as inherited.
   */
  getServiceReportTarget(
    name: string,
    path: ReadonlyArray<string | number> = [],
  ): ServiceReportTarget {
    const direct = this.getNodeAtPath(["services", name, ...path]);
    if (hasRange(direct)) return { node: direct, inherited: false };

    const mergeNode = this.getServiceMergeNode(name);
    if (hasRange(mergeNode)) return { node: mergeNode, inherited: true };

    const svcMap = this.getServiceMap(name);
    if (hasRange(svcMap)) return { node: svcMap, inherited: true };

    return { node: { range: null }, inherited: true };
  }

  /** The AST node at a path of keys and array indices, if it exists. */
  getNodeAtPath(path: ReadonlyArray<string | number>): unknown {
    if (path.length === 0) return this.doc.contents;
    return this.doc.getIn(path, true);
  }

  /** The key node of `key` inside the map at `path`, if it exists. */
  getKeyNodeAtPath(path: ReadonlyArray<string | number>, key: string): unknown {
    const parent = this.getNodeAtPath(path);
    if (!isMap(parent)) return undefined;
    const pair = parent.items.find((item) => this.pairKeyName(item) === key);
    return pair?.key;
  }

  /**
   * The YAML tag of the node at `path` (for example `!reset` or `!override`,
   * which Compose uses in override files).
   */
  getTagAtPath(path: ReadonlyArray<string | number>): string | undefined {
    const node = this.getNodeAtPath(path);
    if (node === null || typeof node !== "object") return undefined;
    const tag = (node as { tag?: unknown }).tag;
    return typeof tag === "string" ? tag : undefined;
  }

  get root(): YAMLMap | null {
    return isMap(this.doc.contents) ? this.doc.contents : null;
  }

  get parseErrors(): string[] {
    return this.parseProblems.map((problem) => problem.message);
  }

  /**
   * YAML errors with the position the parser reported. The message is reduced
   * to a single line: the parser appends the offending snippet, which would
   * break the one-diagnostic-per-line contract of the output formats.
   */
  get parseProblems(): Array<{ message: string; position: SourcePosition }> {
    const problems = this.doc.errors.map((error) => {
      const [start] = error.linePos ?? [];
      // The parser repeats the position in the text; the diagnostic already
      // carries it, so drop the duplicate.
      const firstLine = error.message
        .split("\n")[0]
        .replace(/ at line \d+, column \d+:?$/, "")
        .replace(/:$/, "");
      return {
        message: firstLine,
        position: {
          line: start?.line ?? 1,
          column: start?.col ?? 1,
        },
      };
    });

    // A document that parses but cannot be resolved is just as broken, and
    // `docker compose config` rejects it too. Only worth looking for when the
    // parser itself was happy.
    if (problems.length === 0) {
      this.toJS();
      if (this.#dataError !== undefined) {
        const message = describeDataError(this.#dataError);
        const name = /: ([^:\s]+)$/.exec(message)?.[1];
        problems.push({
          message,
          position: (name === undefined
            ? undefined
            : this.#aliasPosition(name)) ?? {
            line: 1,
            column: 1,
          },
        });
      }
    }

    return problems;
  }

  offsetToPosition(offset: number): SourcePosition {
    let line = 1;
    let lastNewline = -1;
    const len = Math.min(offset, this.source.length);
    for (let i = 0; i < len; i++) {
      if (this.source[i] === "\n") {
        line++;
        lastNewline = i;
      }
    }
    return { line, column: offset - lastNewline };
  }

  getNodeRange(node: { range?: [number, number, number] | null }): SourceRange {
    if (!node.range) {
      return {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
      };
    }
    return {
      start: this.offsetToPosition(node.range[0]),
      end: this.offsetToPosition(node.range[1]),
    };
  }

  /** Get all top-level key names in document order. */
  getTopLevelKeys(): string[] {
    const root = this.root;
    if (!root) return [];
    return root.items.map((pair) => this.pairKeyName(pair));
  }

  /** Get the services map, or null if not present. */
  getServicesMap(): YAMLMap | null {
    const root = this.root;
    if (!root) return null;
    const servicesPair = root.items.find(
      (p) => this.pairKeyName(p) === "services",
    );
    if (!servicesPair) return null;
    return isMap(servicesPair.value) ? servicesPair.value : null;
  }

  /** Get the YAMLMap for a specific service. */
  getServiceMap(name: string): YAMLMap | null {
    const services = this.getServicesMap();
    if (!services) return null;
    const pair = services.items.find((p) => this.pairKeyName(p) === name);
    if (!pair) return null;
    return isMap(pair.value) ? pair.value : null;
  }

  /** Extract the string key name from a Pair. */
  pairKeyName(pair: Pair): string {
    if (isScalar(pair.key)) {
      // With merge keys enabled, `<<` is parsed as a symbol; rules keep
      // treating it as the string "<<".
      if (typeof pair.key.value === "symbol") return "<<";
      return String(pair.key.value);
    }
    return String(pair.key);
  }
}

/** The first line of a resolution failure, without the parser's own snippet. */
function describeDataError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0].trim();
}
