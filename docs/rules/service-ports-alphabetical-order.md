# service-ports-alphabetical-order

| Preset | Severity |
| --- | --- |
| `recommended` | off |
| `strict` | off |

🔧 Fixable with `--fix`.

## What it does

Checks ascending numeric order by published host port within each run of
adjacent, fixed single-port bindings in a locally declared `ports` list.
Short and long forms can appear in the same run. Bindings with the same
published number can appear in either order.

Short-form ranges, target-only ports and variable expressions are compared as
written, rather than by their unknown runtime values. Aliases and unsupported
bindings break a run. The rule skips inherited lists and reset declarations.

## Why it matters

Numeric ordering helps reviewers find a particular host port. Automatic fixes are limited to block lists of distinct literal short or long bindings
with their attached comments. Files with anchors or aliases, or lists with nearby suppression
directives are reported without a fix.

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
