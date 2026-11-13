# service-ports-alphabetical-order

| Preset | Severity |
| --- | --- |
| `recommended` | off |
| `strict` | off |

## What it does

Checks ascending numeric order by published host port within each run of
adjacent, fixed single-port bindings in a locally declared `ports` list.
Short and long forms can appear in the same run. Bindings with the same
published number can appear in either order.

Ranges, dynamic or target-only ports, interpolation, aliases, and entries
without a supported literal binding break a run. The rule skips inherited
lists and reset declarations.

## Why it matters

Numeric ordering helps reviewers find a particular host port. The rule is
report-only because Compose retains the sequence order and entries such as
published ranges can interact with other bindings.

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
