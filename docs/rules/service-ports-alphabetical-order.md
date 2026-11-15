# service-ports-alphabetical-order

| Preset | Severity |
| --- | --- |
| `recommended` | off |
| `strict` | off |

🔧 Fixable with `--fix`.

## What it does

Checks ordering by the written published port in locally declared `ports` lists.
Literal ports sort numerically. Short-form ranges, target-only ports and
short- or long-form variable expressions are compared as written, not by their
unknown runtime values. Aliases and unsupported bindings break a run. The
rule skips inherited lists and reset declarations.

## Why it matters

Ordering helps reviewers find a particular port. Automatic fixes are limited
to block lists of fixed short or long bindings and disjoint equal-length
short-form ranges. Inline comments move with their bindings. Standalone
comments are report-only because their attachment may be ambiguous. Bindings
with the same published port keep their relative order. Overlapping ranges,
dynamic allocation pools, files with anchors or aliases, nearby suppression
directives and multiline scalars are not automatically fixed.

## Incorrect

```yaml
services:
  app:
    ports:
      - "8080:80"
      - target: 443
        published: "844"
```

## Correct

```yaml
services:
  app:
    ports:
      - target: 443
        published: "844"
      - "8080:80"
```
