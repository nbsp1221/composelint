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

Simple `${NAME}:target` expressions are compared as written, rather than by
their unknown runtime value. Ranges, dynamic or target-only ports, complex
interpolation, aliases, and unsupported bindings break a run. The rule skips
inherited lists and reset declarations.

## Why it matters

Numeric ordering helps reviewers find a particular host port. Automatic fixes are limited to block lists of distinct literal short bindings
without comments or anchors. Other supported cases are reported without a fix.

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
