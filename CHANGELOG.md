# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version is below `1.0.0`, the rule set, the configuration format and
the Node API may change in a minor release. Such changes are listed here.

## [Unreleased]

### Fixed

- `service-key-order` and `top-level-order` no longer report keys the Compose
  Specification does not define, and `--fix` no longer moves them: such keys
  have no meaningful position, and `spec-schema` already reports them.

## [0.2.0] - 2026-08-12

### Added

- `no-unbound-ports` accepts an `allow` option for exact, intentional public
  host ports, matched by service name, published port and protocol.

### Fixed

- `no-unbound-ports` now reports the short syntax that only specifies a
  container port, because Docker assigns and publishes a host port for it at
  runtime rather than keeping it internal to the Compose network.

## [0.1.0] - 2026-07-29

First release.

### Rules

Eleven rules across four categories, all enabled by the `recommended` preset:

- `spec-schema` — validates the file against the vendored Compose Specification
  schema: unknown keys and wrong value types at every level.
- `top-level-order`, `service-key-order` — key ordering, with a fix.
  `service-key-order` places all 93 service keys the specification defines.
- `no-version-field` — the obsolete `version` field, with a fix.
- `no-privileged`, `no-host-network`, `no-cap-add-all`, `no-unbound-ports`,
  `image-require-tag` — privilege escalation, loss of network isolation,
  wildcard port publishing, unpinned images.
- `require-name`, `require-healthcheck`.

### Features

- **Inheritance is resolved before rules run.** `<<: *anchor`, `extends` within
  a file, `include:` fragments and override files, so a value hidden behind an
  anchor is still checked and an inherited value is marked as such.
- **Fixes are text edits, not a re-serialization.** Comments, quoting style,
  line width and CRLF endings are preserved; `--fix` is idempotent and refuses
  to write a file it cannot re-parse.
- **Suppression comments.** `disable-file`, `disable-next-line`, `disable-line`
  and `disable`/`enable` ranges, by rule name, with an optional reason after
  ` -- `. Unused directives, unknown rule names and a misspelled prefix
  (`compose-lint-…` instead of `composelint-…`) are all reported.
- **Configuration** through any cosmiconfig location, with per-rule severities
  and options, `exclude` and `partials` globs. Invalid values are reported
  rather than silently ignored.
- **Output** as `stylish`, `json`, `github` (workflow annotations) or `sarif`
  (with `helpUri` per rule, for GitHub Code Scanning).
- **CLI** with `--fix`, `--format`, `--preset`, `--config`, `--quiet`,
  `--max-warnings`, and exit codes `0` / `1` / `2`.
- **Node API**: `lintSource`, `lintAndFix`, `resolveConfig`, `allRules` and
  `ComposeDocument`, with type declarations. Both linting functions are pure.

### Known limitations

The security rules are one layer, not a complete container security review. See
[Scope of the security checks](README.md#scope-of-the-security-checks).

[Unreleased]: https://github.com/nbsp1221/composelint/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nbsp1221/composelint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nbsp1221/composelint/releases/tag/v0.1.0
