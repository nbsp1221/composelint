# services-alphabetical-order 🔧

| Preset | Severity |
| --- | --- |
| `recommended` | off |
| `strict` | off |

🔧 Fixable with `--fix`.

## What it does

Checks the names written in the top-level `services` mapping. Sorting is
case-sensitive and uses ascending ASCII order, so `App` precedes `app` and
`app10` precedes `app2`. Enable it with
`"rules": { "services-alphabetical-order": "warn" }`.

The rule skips reset collections, alias-only or inherited collections, and
mappings with a YAML merge key or a nonliteral name. Flow mappings are
reported without a fix. In block mappings, fixes move whole entries with
their adjacent comments. Fixes are withheld when anchor bindings, suppression
directives, multiline scalars, or explicit YAML keys make a move unsafe.

## Why it matters

A predictable order makes it easier to find a service and to review additions.
Compose uses dependency relationships to determine startup order.

## Incorrect

```yaml
services:
  worker:
    image: busybox:1
  api:
    image: nginx:1
```

## Correct

```yaml
services:
  api:
    image: nginx:1
  worker:
    image: busybox:1
```
