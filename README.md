# composelint

[![npm](https://img.shields.io/npm/v/composelint.svg)](https://www.npmjs.com/package/composelint)
[![CI](https://github.com/nbsp1221/composelint/actions/workflows/ci.yml/badge.svg)](https://github.com/nbsp1221/composelint/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/composelint.svg)](LICENSE)

Linter and formatter for Docker Compose files, with key ordering, style, and security checks.

- **Validates against the Compose Specification.** The official JSON schema is vendored, so unknown keys and wrong value types are caught at every level, not just at the top.
- **Understands inheritance.** `<<: *anchor`, `extends`, `include:` and override files are resolved before rules run, so a setting hidden behind an anchor is still checked.
- **Fixes without churn.** `--fix` edits the original text instead of re-serializing the document: comments, quoting style, line wrapping and CRLF endings survive untouched.
- **Fits a pipeline.** Stylish, JSON, GitHub annotation and SARIF output; `--max-warnings` for a gate; documented exit codes.

## Install

```sh
npm install --save-dev composelint
```

Or run it without installing:

```sh
npx composelint
```

Requires Node.js 22 or newer.

## Quick start

```sh
composelint                  # walk the current directory
composelint compose.yaml     # lint one file
composelint stacks/          # lint a directory
composelint --fix            # apply fixes
```

```
compose.yaml
  1:1     error  Top-level "version" field is obsolete in modern Compose and should be removed  no-version-field [fixable]
  6:9     warn   Service "db": port "5432:5432" is published on all interfaces (0.0.0.0)        no-unbound-ports
  4:12    warn   Service "web": image "nginx" has no explicit tag (defaults to "latest")        image-require-tag

✖ 3 problems (1 error, 2 warnings)
  1 fixable with --fix
```

## CLI

| Option | Description |
| --- | --- |
| `--fix` | Apply fixes and write the files back |
| `--format <name>` | `stylish` (default), `json`, `github`, `sarif` |
| `--preset <name>` | `recommended` (default) or `strict` |
| `--config <path>` | Use a specific configuration file |
| `-q`, `--quiet` | Print errors only (warnings are still counted) |
| `--max-warnings <n>` | Fail when more than `n` warnings remain (`-1`, the default, disables the check) |
| `--version`, `--help` | |

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | No errors, and warnings within `--max-warnings` |
| `1` | At least one error, or too many warnings |
| `2` | composelint could not run: bad option, unreadable file, broken configuration |

With no arguments the current directory is walked recursively for `compose.yaml`, `docker-compose.yml`, `compose.prod.yaml`, `prod.compose.yaml` and similar names. See [which files are linted](docs/configuration.md#which-files-are-linted).

## Configuration

composelint works with no configuration. To adjust it, add `.composelintrc.json` (or any [supported location](docs/configuration.md#where-the-configuration-lives)):

```json
{
  "rules": {
    "no-unbound-ports": "error",
    "require-healthcheck": ["warn", { "exclude": ["migrate"] }]
  },
  "exclude": ["examples/**"]
}
```

Full reference: **[docs/configuration.md](docs/configuration.md)**.

## Rules

Legend: 💼 error in the preset · ⚠️ warning in the preset · 🔧 fixable with `--fix` · ⚙️ has options

| Rule | Category | recommended | strict | 🔧 | ⚙️ |
| --- | --- | --- | --- | --- | --- |
| [spec-schema](docs/rules/spec-schema.md) | spec | 💼 | 💼 | | |
| [top-level-order](docs/rules/top-level-order.md) | style | ⚠️ | 💼 | 🔧 | ⚙️ |
| [service-key-order](docs/rules/service-key-order.md) | style | ⚠️ | 💼 | 🔧 | ⚙️ |
| [no-version-field](docs/rules/no-version-field.md) | style | 💼 | 💼 | 🔧 | |
| [no-privileged](docs/rules/no-privileged.md) | security | ⚠️ | 💼 | | |
| [no-host-network](docs/rules/no-host-network.md) | security | ⚠️ | 💼 | | |
| [no-cap-add-all](docs/rules/no-cap-add-all.md) | security | ⚠️ | 💼 | | |
| [no-unbound-ports](docs/rules/no-unbound-ports.md) | security | ⚠️ | 💼 | | |
| [image-require-tag](docs/rules/image-require-tag.md) | security | ⚠️ | 💼 | | ⚙️ |
| [require-name](docs/rules/require-name.md) | best-practice | ⚠️ | 💼 | | |
| [require-healthcheck](docs/rules/require-healthcheck.md) | best-practice | ⚠️ | 💼 | | ⚙️ |

### Scope of the security checks

The `security` rules cover privilege escalation through `privileged` and `cap_add: [ALL]`, loss of network isolation through `network_mode: host` and wildcard port publishing, and unpinned images. They are **not** a complete container security review: mounting the Docker socket, credentials in `environment`, running as root, missing `no-new-privileges`, host namespace sharing through `pid`/`ipc`/`uts`, and digest pinning are not checked. Treat composelint as one layer, alongside an image scanner and a review against the [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html).

## Suppressing a rule for one line

```yaml
services:
  runner:
    image: docker:27-dind
    privileged: true  # composelint-disable-line no-privileged -- dind needs it
```

`disable-file`, `disable-next-line`, `disable-line` and `disable`/`enable` ranges are all supported, and a directive that suppresses nothing is reported so stale exceptions do not accumulate. Full reference: **[docs/suppressions.md](docs/suppressions.md)**.

## Continuous integration

```yaml
name: composelint
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npx composelint --format github --max-warnings 0
```

`--format github` turns each diagnostic into a workflow annotation on the offending line. To feed GitHub Code Scanning instead, emit SARIF and upload it:

```yaml
      - run: npx composelint --format sarif > composelint.sarif
        continue-on-error: true
      - uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: composelint.sarif
```

## Node API

```ts
import { lintSource, lintAndFix, resolveConfig, allRules } from "composelint";

const config = resolveConfig({ rules: { "require-healthcheck": "off" } });

const { result } = lintSource(source, "compose.yaml", allRules, config);
for (const d of result.diagnostics) {
  console.log(`${d.range.start.line}:${d.range.start.column} ${d.severity} ${d.message} (${d.ruleId})`);
}

const { source: fixed } = lintAndFix(source, "compose.yaml", allRules, config);
```

`resolveConfig` takes the same object a configuration file holds and fills in the
defaults; `allRules` is the built-in rule list. Both functions are pure: they
never read or write files, so the caller decides what to do with the result.

## Contributing

A rule consists of three files, following the ESLint convention:

```
src/rules/<category>/<name>.ts     the rule
tests/rules/<category>.test.ts     its tests
docs/rules/<name>.md               its documentation
```

Tests enforce that set: every rule must have a documentation file containing the standard sections, every option a rule declares must be documented, and the table above must match the rule metadata.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the rule conventions, how fixes work, and the release process. Changes are listed in **[CHANGELOG.md](CHANGELOG.md)**.

A bug report needs the Compose file that reproduces it; a rule proposal needs an example that should stay quiet as well as one that should be reported. The issue forms ask for both. Vulnerabilities go through [SECURITY.md](SECURITY.md) rather than a public issue. Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

The Compose Specification schema is vendored in [`schemas/`](schemas/) and refreshed with `pnpm schema:update`.

## License

[MIT](LICENSE). The bundled Compose Specification schema is Apache-2.0; see [NOTICE](NOTICE).
