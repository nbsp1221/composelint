# Contributing

## Setup

```sh
pnpm install
pnpm build
```

Node.js 22.18 or newer — the bundler requires it, although the published
package itself runs on any Node 22. pnpm as declared in `packageManager`.

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Checks

```sh
pnpm lint        # Biome: format, lint, import order
pnpm typecheck   # tsc --noEmit
pnpm test        # unit tests (fast, no build needed)
pnpm test:e2e    # runs the built CLI in a temporary directory
pnpm test:all    # both
```

`pnpm lint:fix` applies the formatting and safe lint fixes. CI runs `lint:ci`,
`typecheck`, `test` and `test:e2e` on Node 22, 24 and 26, and installs the
packed tarball to check that the published package works.

## Adding a rule

A rule is three files, following the ESLint convention:

```
src/rules/<category>/<name>.ts     the rule
tests/rules/<category>.test.ts     its tests
docs/rules/<name>.md               its documentation
```

Then register it in `src/rules/index.ts` and add a row to the table in
`README.md`.

Tests enforce the parts that are easy to forget:

- every rule has a documentation file with the standard sections
  (`What it does`, `Why it matters`, `Incorrect`, `Correct`);
- every option a rule declares is documented under `## Options`;
- the README table matches the rule metadata, including the severity in each
  preset and the 🔧 / ⚙️ markers;
- every preset covers every rule.

So a missing doc or a stale README row fails `pnpm test`, not review.

### Rule conventions

- **Read the merged data.** Use `document.getMergedServiceValue()` and friends
  rather than walking the AST, so anchors and `extends` are taken into account.
- **Report through the helper.** `reportServiceValue(context, service, path,
  message)` finds the node, marks inherited values, and reports. Bypassing it
  means an inherited value gets reported on a line that does not explain it.
- **Message shape.** Service-scoped messages start with `Service "<name>": `,
  are a single line, and do not end with a period. A test enforces this.
- **Declare options** in `meta.options`; the configuration loader validates
  values against the declaration and reports anything unexpected.
- **`requiresFullProject: true`** for a rule that cannot be answered from an
  override file or an `include:` fragment.

## The public API

`src/index.ts` is what the package exports. A test pins that list, so adding an
export is a deliberate act rather than a side effect of an import, and the
README snippet is checked against it.

## Fixes

Fixes are text edits on the original source, not AST mutations. Use the
helpers in `src/core/text-edit.ts` and return `null` when a shape cannot be
edited as whole lines (a flow mapping, for example) — the diagnostic is then
reported without a fix. `lintAndFix` applies non-overlapping edits, re-lints,
and repeats; it discards a pass that would make the file unparseable.

## Updating the Compose schema

```sh
pnpm schema:update
```

This refreshes `schemas/compose-spec.json` from upstream and records the
commit, date and checksum in `schemas/compose-spec.meta.json`. A test compares
the checksum, and another test fails if the specification gained a service key
that `service-key-order` does not place yet.

Note that `schemas/` is excluded from Biome, so the vendored file stays byte
identical to upstream.

## Releasing

1. Update `CHANGELOG.md` (move `Unreleased` items under the new version).
2. Bump the version in `package.json`.
3. Push a tag: `git tag v0.2.0 && git push origin v0.2.0`.

The release workflow checks that the tag matches `package.json`, runs the full
check suite, then publishes from a protected environment that requires a manual
approval.

Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
over OIDC: each release authenticates with a short-lived token that npm issues
to this workflow, and npm attaches a provenance attestation automatically. There
is no npm token in this repository, and none should be added.
