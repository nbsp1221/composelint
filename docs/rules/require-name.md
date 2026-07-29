# require-name

A Compose file should declare a top-level `name`.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

Skipped for [partial files](../configuration.md#partials) — an override file or an `include:` fragment is not a project on its own.

## What it does

Reports a file with no top-level `name`, or with a `name` that is empty or whitespace only.

## Why it matters

Without `name`, Compose derives the project name from the directory the file sits in. That has three consequences:

- The same file produces different project names in `~/work/shop` and `~/deploy/shop-prod`, so containers, networks and volumes are named differently.
- CI checkout directories are often generated, so the project name changes between runs and volumes do not line up.
- `docker compose down` in the wrong directory silently targets a different project.

Declaring the name makes the project identity a property of the file rather than of the filesystem.

## Incorrect

```yaml
services:
  web:
    image: nginx:1.27
```

```
1:1  warn  Missing top-level "name" field — set it for stable project identifiers across directories and CI  require-name
```

An empty value counts as missing:

```yaml
name: ""
```

## Correct

```yaml
name: shop
services:
  web:
    image: nginx:1.27
```

## Known limitations

- The rule does not check that the name is a valid Compose project name (lowercase, no spaces); [`spec-schema`](spec-schema.md) covers what the specification allows.
- A file linted on its own that happens to be a fragment is only recognised as partial if its name matches the override convention or it is reachable through an `include:` in the project. Otherwise declare it with the `partials` option.

## Related

- [Compose file reference: name](https://docs.docker.com/reference/compose-file/version-and-name/)
- [Partial files](../configuration.md#partials)
