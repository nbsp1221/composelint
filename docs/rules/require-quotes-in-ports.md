# require-quotes-in-ports 🔧

| Preset | Severity |
| --- | --- |
| `recommended` | off |
| `strict` | off |

🔧 Fixable with `--fix`.

## What it does

Checks plain short entries in locally declared `ports` and `expose` lists.
Both single and double quotes satisfy the rule. It skips long syntax,
inherited and aliased entries, reset declarations, and complex scalar
spellings outside the rule's short-syntax scope.

A fix adds double quotes to a single plain string token when the replacement
parses to the same string. It preserves comments, anchors, collection tags,
and the literal spelling of supported interpolation expressions. Numeric
values and explicitly tagged scalars are report-only. Quoting a number could
change its YAML type or the value seen through an alias.

## Why it matters

Quoting short host and container port pairs avoids ambiguity with parsers
that support YAML 1.1 base-60 numbers. Quoting `expose` entries makes the two
lists consistent.

## Incorrect

```yaml
services:
  app:
    ports:
      - 8080:80
    expose:
      - 80-81/tcp
```

## Correct

```yaml
services:
  app:
    ports:
      - "8080:80"
    expose:
      - "80-81/tcp"
```
