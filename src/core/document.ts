import {
  type Alias,
  type Document,
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  visit,
  type YAMLMap,
} from "yaml";
import { portIdentity } from "./ports.js";
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

interface ResolvedService {
  value: Record<string, unknown>;
  localIndices?: Map<string, Array<number | null>>;
  inheritedNulls?: Set<string>;
}

const EXTENDED_SEQUENCES = ["ports", "cap_add"] as const;
const EXTENDED_SCALARS = ["image", "network_mode", "privileged"] as const;
const RESETTABLE_FIELDS = [
  ...EXTENDED_SEQUENCES,
  ...EXTENDED_SCALARS,
  "build",
  "healthcheck",
  "provider",
] as const;

interface YamlReferences {
  targets: WeakMap<Alias, Node>;
  repeatedReferenceOffsets: number[];
}

function extendService(
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  replacesField: (key: string) => boolean,
): ResolvedService {
  const value = { ...base, ...local };
  const localIndices = new Map<string, Array<number | null>>();
  const inheritedNulls = new Set<string>();
  for (const key of EXTENDED_SCALARS) {
    if (
      local[key] === null &&
      Object.hasOwn(base, key) &&
      base[key] !== null &&
      base[key] !== undefined &&
      !replacesField(key)
    ) {
      value[key] = base[key];
      inheritedNulls.add(key);
    }
  }
  for (const key of EXTENDED_SEQUENCES) {
    const parent = base[key];
    const child = local[key];
    if (!Array.isArray(parent) || replacesField(key)) continue;
    if (child === null) {
      value[key] = parent;
      inheritedNulls.add(key);
      continue;
    }
    if (!Array.isArray(child)) continue;

    const entries = new Map<unknown, { item: unknown; index: number | null }>();
    const identity = key === "ports" ? portIdentity : (item: unknown) => item;
    for (const item of parent) {
      entries.set(identity(item), { item, index: null });
    }
    for (const [index, item] of child.entries()) {
      entries.set(identity(item), { item, index });
    }
    value[key] = Array.from(entries.values(), ({ item }) => item);
    localIndices.set(
      key,
      Array.from(entries.values(), ({ index }) => index),
    );
  }
  return { value, localIndices, inheritedNulls };
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
  #resolved: Map<string, ResolvedService> | undefined;

  /** Services whose definition partly lives in another file. */
  readonly #externalExtends = new Set<string>();
  readonly #mayHaveAliases: boolean;
  readonly #hasMergeTags: boolean;
  #references: YamlReferences | undefined;

  constructor(source: string, filePath: string) {
    this.source = source;
    this.filePath = filePath;
    this.#mayHaveAliases = source.includes("*");
    this.#hasMergeTags =
      source.includes("!reset") || source.includes("!override");
    // `merge` resolves YAML merge keys (`<<: *anchor`), which Compose supports
    // and which schema validation needs to see as plain data.
    this.doc = parseDocument(source, { keepSourceTokens: true, merge: true });
  }

  #yamlReferences(): YamlReferences {
    if (this.#references) return this.#references;
    const anchors = new Map<string, Node>();
    const definitions = new Map<string, number[]>();
    const aliases = new Map<string, number[]>();
    const targets = new WeakMap<Alias, Node>();
    visit(this.doc, {
      Node: (_key, node) => {
        const offset = node.range?.[0];
        if (isAlias(node)) {
          const target = anchors.get(node.source);
          if (target) targets.set(node, target);
          if (offset !== undefined) {
            const offsets = aliases.get(node.source) ?? [];
            offsets.push(offset);
            aliases.set(node.source, offsets);
          }
        } else if (node.anchor) {
          anchors.set(node.anchor, node);
          if (offset !== undefined) {
            const offsets = definitions.get(node.anchor) ?? [];
            offsets.push(offset);
            definitions.set(node.anchor, offsets);
          }
        }
      },
    });
    const repeatedReferenceOffsets: number[] = [];
    for (const [name, offsets] of definitions) {
      const references = aliases.get(name);
      if (offsets.length < 2 || !references) continue;
      for (const offset of offsets) repeatedReferenceOffsets.push(offset);
      for (const offset of references) repeatedReferenceOffsets.push(offset);
    }
    this.#references = { targets, repeatedReferenceOffsets };
    return this.#references;
  }

  hasRepeatedAnchorReference(start: number, end: number): boolean {
    return (
      this.#mayHaveAliases &&
      this.#yamlReferences().repeatedReferenceOffsets.some(
        (offset) => start <= offset && offset < end,
      )
    );
  }

  #resolveAlias(node: unknown): unknown {
    return isAlias(node) ? this.#yamlReferences().targets.get(node) : node;
  }

  #mergedMapValue(
    map: YAMLMap,
    key: string | number,
    visited: Set<YAMLMap>,
  ): unknown {
    const direct = map.get(key, true);
    if (direct !== undefined) return direct;
    if (visited.has(map)) return undefined;
    visited.add(map);
    for (const pair of map.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "symbol") continue;
      const source = this.#resolveAlias(pair.value);
      const candidates = isSeq(source) ? source.items : [source];
      for (const candidate of candidates) {
        const resolved = this.#resolveAlias(candidate);
        if (!isMap(resolved)) continue;
        const value = this.#mergedMapValue(resolved, key, visited);
        if (value !== undefined) return value;
      }
    }
    return undefined;
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
   * anything it takes from a service it `extends` in this same file. Ports
   * and added capabilities combine. For supported inherited fields, an
   * untagged null can fall back to the parent and a reset clears the field.
   */
  getMergedService(name: string): Record<string, unknown> | null {
    return this.#resolvedServices().get(name)?.value ?? null;
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
  #resolvedServices(): Map<string, ResolvedService> {
    if (this.#resolved) return this.#resolved;

    const resolved = new Map<string, ResolvedService>();
    this.#resolved = resolved;

    const services = this.getMergedServices();
    if (!services) return resolved;

    const resolve = (
      name: string,
      seen: ReadonlySet<string>,
    ): ResolvedService | null => {
      if (!Object.hasOwn(services, name)) return null;
      const raw = services[name];
      if (!isPlainRecord(raw)) return null;

      const tag = (key: string) =>
        this.#hasMergeTags
          ? this.getTagAtPath(["services", name, key])
          : undefined;
      let value = raw;
      if (this.#hasMergeTags) {
        for (const key of RESETTABLE_FIELDS) {
          if (Object.hasOwn(raw, key) && tag(key) === "!reset") {
            if (value === raw) value = { ...raw };
            value[key] = undefined;
          }
        }
      }
      const local = { value };
      const target = extendsTarget(raw);
      if (target === null) return local;

      if (target.file !== undefined) {
        this.#externalExtends.add(name);
        return local;
      }

      // A cycle is invalid Compose; stop rather than recurse forever.
      if (
        target.service === undefined ||
        target.service === name ||
        seen.has(target.service)
      ) {
        return local;
      }

      const base = resolve(target.service, new Set([...seen, name]));
      if (this.#externalExtends.has(target.service)) {
        this.#externalExtends.add(name);
      }
      return base
        ? extendService(base.value, value, (key) => tag(key) === "!override")
        : local;
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

  inheritsNullField(name: string, key: string): boolean {
    return (
      this.#resolvedServices().get(name)?.inheritedNulls?.has(key) ?? false
    );
  }

  /** The effective keys of a service, inherited keys included. */
  getMergedServiceKeys(name: string): string[] {
    const service = this.getMergedService(name);
    return service
      ? Object.keys(service).filter((key) => service[key] !== undefined)
      : [];
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
    const [key, index, ...rest] = path;
    const service = this.#resolvedServices().get(name);
    const indices =
      typeof key === "string" ? service?.localIndices?.get(key) : undefined;
    const localIndex = typeof index === "number" ? indices?.[index] : undefined;
    const raw = this.getMergedServices()?.[name];
    const fromExtends =
      localIndex === null ||
      (typeof key === "string" &&
        service !== undefined &&
        (service.inheritedNulls?.has(key) ||
          (Object.hasOwn(service.value, key) &&
            isPlainRecord(raw) &&
            !Object.hasOwn(raw, key))));

    if (fromExtends) {
      const node = this.getKeyNodeAtPath(["services", name], "extends");
      if (hasRange(node)) return { node, inherited: true };
    } else {
      const directPath =
        typeof localIndex === "number" ? [key, localIndex, ...rest] : path;
      const direct = this.getNodeAtPath(["services", name, ...directPath]);
      if (hasRange(direct)) return { node: direct, inherited: false };

      if (typeof key === "string" && typeof index === "number") {
        const alias = this.getNodeAtPath(["services", name, key]);
        if (isAlias(alias) && hasRange(alias)) {
          return { node: alias, inherited: true };
        }
      }
    }

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
    let node: unknown = this.doc.contents;
    for (const key of path) {
      const resolved = this.#resolveAlias(node);
      if (isMap(resolved)) {
        node = this.#mergedMapValue(resolved, key, new Set());
      } else if (isSeq(resolved)) {
        node = resolved.get(key, true);
      } else {
        return undefined;
      }
    }
    const resolved = this.#resolveAlias(node);
    return isNode(resolved) ? resolved.tag : undefined;
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
