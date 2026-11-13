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
    "no-unbound-ports": [
      "error",
      {
        "allow": [
          {
            "service": "proxy",
            "published": ["80/tcp", "443/tcp", "443/udp"],
            "reason": "Public ingress"
          }
        ]
      }
    ],
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
Rule-specific option shapes are documented on each rule page; for example,
[`no-unbound-ports`](rules/no-unbound-ports.md#options) accepts structured
allowances for intentionally public services.

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

Use `--exclude <glob>` or `--exclude=<glob>` for exclusions on a single run.
Repeat the option for each pattern and use forward slashes in globs. CLI
patterns run in argument order after the built-in and configuration patterns.
They match paths inside the working directory. Configuration patterns keep
their own base directory.

```sh
composelint --exclude 'generated/**' --exclude '!generated/keep/**'
```

The later pattern can re-include files inside an excluded directory during
discovery. The walker still skips dot-directories and only discovers Compose
file names. An explicitly named file that matches the final exclusions is
skipped and reported on stderr. A missing target is a usage error even if its
name matches an exclusion. When no files remain, the CLI exits successfully
and JSON or SARIF reports contain no results.

## `partials`

Glob patterns for files that carry only part of a project. Rules that ask a question about the project as a whole are skipped for them:

| Rule | Why it needs the whole project |
| --- | --- |
| [`require-name`](rules/require-name.md) | Only the base file declares the project name. |
| [`require-healthcheck`](rules/require-healthcheck.md) | The healthcheck may be defined in the file being overridden. |
| [`no-duplicate-container-names`](rules/no-duplicate-container-names.md) | The effective name or service profile may come from another file. |
| [`no-conflicting-published-ports`](rules/no-conflicting-published-ports.md) | The effective host bindings or service profiles may come from another file. |

Every other rule still runs, so an override file that publishes a port on all interfaces is still reported.

Two kinds of partial files are recognised **without configuration**:

- Files matching the Compose override convention: `**/*.override.yaml`, `**/*.override.yml`.
- Files selected for linting whose paths appear in a top-level `include:` in a scanned Compose file. The CLI recognizes string entries, `path:` objects, and `path:` lists, with relative paths resolved from the declaring file.

The CLI lints each selected file separately. It uses `include:` references to
identify partials and does not add targets to the lint run or combine files into
a project. Same-file `extends` combines `ports`, `cap_add`, and `profiles`.
Plain nulls in those lists or in `container_name`, `image`, `network_mode`,
and `privileged` retain the parent's value when present. The linter also honors
`!reset` on these fields
and on `build`, `healthcheck`, and `provider` when checking effective service
settings. The linter does not load external `extends` targets.

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
