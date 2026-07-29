# Configuration

composelint runs without configuration. A configuration file lets you change rule severities, pass rule options, and tell the linter which files to skip or treat as fragments.

## Where the configuration lives

Any of these, discovered with [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig):

```
.composelintrc
.composelintrc.json
.composelintrc.yml
.composelintrc.yaml
composelint.config.js
composelint.config.mjs
composelint.config.ts
package.json   → "composelint" key
```

The search walks up to the project root (the first directory with a `package.json` or `.git`), so running the CLI from a subdirectory uses the same configuration as running it from the root. `--config <path>` loads a specific file instead.

Every glob in the configuration is resolved **relative to the configuration file**, not to the current directory. A configuration committed to a repository therefore behaves the same wherever it is run from.

## Full example

```json
{
  "preset": "recommended",
  "rules": {
    "no-unbound-ports": "error",
    "no-version-field": "off",
    "require-healthcheck": ["warn", { "exclude": ["migrate"] }],
    "image-require-tag": ["error", { "forbiddenTags": ["latest", "main"] }]
  },
  "exclude": ["examples/**", "!examples/keep/**"],
  "partials": ["fragments/**"]
}
```

Unknown top-level keys are reported rather than ignored, so a typo such as `excludes` does not silently do nothing.

## `preset`

`"recommended"` (default) or `"strict"`.

| Preset | Meaning |
| --- | --- |
| `recommended` | Every rule enabled at its declared severity. Obsolete syntax and schema violations are errors; opinionated checks are warnings, so they do not fail a pipeline on their own. |
| `strict` | The same rules, all raised to `error`. |

Loosen a preset per rule with `"off"` rather than by switching presets. `--preset` on the command line overrides the configuration file.

## `rules`

Keys are rule names. Four notations are accepted, all equivalent:

```json
{
  "rules": {
    "no-unbound-ports": "error",
    "no-host-network": 2,
    "no-privileged": ["error"],
    "no-cap-add-all": { "severity": "error" }
  }
}
```

Severities are `"error"` / `"warn"` / `"off"`, or `2` / `1` / `0`.

Options go in the second element of the array form, or under `options` in the object form:

```json
{
  "rules": {
    "service-key-order": ["warn", { "order": ["image", "build", "restart"] }],
    "require-healthcheck": { "severity": "warn", "options": { "exclude": ["migrate"] } }
  }
}
```

Each rule declares which options it accepts and their types. An unknown option name or a value of the wrong type is reported and dropped, so a rule never runs on a value it cannot interpret:

```
composelint: Rule "service-key-order": unknown option "orders" — ignored. Known options: order.
composelint: Rule "image-require-tag": option "forbiddenTags" must be an array of strings — ignored.
```

See the [rules index](../README.md#rules) for the options each rule takes.

## `exclude`

Glob patterns for files that should not be linted. User patterns are appended to the built-in list (`**/node_modules`, `**/.git`, `**/dist`, `**/vendor`).

```json
{ "exclude": ["examples/**", "!examples/keep/**"] }
```

Semantics follow ESLint's `ignores`:

- `examples`, `examples/`, and `examples/**` all match the whole directory.
- A pattern starting with `!` un-matches paths that an earlier pattern matched.
- Later patterns win, so order matters.
- Paths outside the configuration file's directory never match.

Naming a file explicitly on the command line does not override `exclude`; the file is skipped and the reason is printed.

## `partials`

Glob patterns for files that carry only part of a project. Rules that ask a question about the project as a whole are skipped for them:

| Rule | Why it needs the whole project |
| --- | --- |
| [`require-name`](rules/require-name.md) | Only the base file declares the project name. |
| [`require-healthcheck`](rules/require-healthcheck.md) | The healthcheck may be defined in the file being overridden. |

Every other rule still runs, so an override file that publishes a port on all interfaces is still reported.

Two kinds of partial files are recognised **without configuration**:

- Files matching the Compose override convention: `**/*.override.yaml`, `**/*.override.yml`.
- Files referenced from a top-level `include:` in any Compose file in the project. The string form, the `path:` object form and a `path:` list are all followed, including relative paths such as `../shared/base.yaml`.

Use `partials` for fragments whose names follow neither convention:

```json
{ "partials": ["fragments/**", "stacks/_*.yaml"] }
```

## Which files are linted

With no arguments, the current directory is walked recursively and these names are linted:

```
compose.yaml            compose.yml
docker-compose.yaml     docker-compose.yml
compose.<anything>.yaml     (compose.prod.yaml, compose.override.yml, …)
<anything>.compose.yaml     (prod.compose.yaml, dev.docker-compose.yml, …)
```

`node_modules`, `.git`, `dist`, `vendor` and dot-directories are skipped. A file named on the command line is linted regardless of its name, so a file called `stack.yaml` can still be checked with `composelint stack.yaml`.
