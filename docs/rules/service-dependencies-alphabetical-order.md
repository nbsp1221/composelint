# service-dependencies-alphabetical-order 🔧

| Preset | Severity |
| --- | --- |
| `recommended` | off |
| `strict` | off |

🔧 Fixable with `--fix`.

## What it does

Checks literal dependency names in a service's own `depends_on` mapping or
short list. Sorting is case-sensitive and uses ascending ASCII order.
Enable it with `"rules": { "service-dependencies-alphabetical-order": "warn" }`.

The rule skips reset, aliased or inherited dependency lists, and collections
with YAML merge keys, nonliteral names, or repeated names. It reports
out-of-order flow collections without a fix. Block edits retain dependency
conditions and move adjacent comments with their entries. The rule withholds
fixes around unsafe anchor bindings, suppression directives, multiline
scalars, and explicit YAML keys. Short lists inside an anchored node are
report-only because aliases can reuse the sequence in an order-sensitive field.

## Why it matters

Consistent order makes dependency changes easier to spot in review. The rule
leaves the dependency relationships and conditions intact.

## Incorrect

```yaml
services:
  web:
    depends_on:
      - cache
      - api
```

## Correct

```yaml
services:
  web:
    depends_on:
      - api
      - cache
```
