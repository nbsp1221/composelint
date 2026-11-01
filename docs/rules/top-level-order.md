# top-level-order 🔧

Top-level keys should follow a specific order.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

🔧 Fixable with `--fix`.

## What it does

Checks that the top-level keys appear in this order:

```
name → include → services → networks → volumes → configs → secrets → models
```

`services` comes first among the content blocks, then the resources they reference, in the order the [Compose reference](https://docs.docker.com/reference/compose-file/) documents them.

The following keys do not participate in ordering comparisons. When `--fix` reorders other keys, they form a pinned group before the ordered keys and keep their original relative order:

- `x-*` extension fields, which may appear anywhere.
- `version`, which is obsolete. [`no-version-field`](no-version-field.md) asks for its removal, so this rule does not also give it a position.
- Keys the Compose Specification does not define. An invalid key has no meaningful position, [`spec-schema`](spec-schema.md) already reports it, and an `order` option cannot change this — listing a key does not make it real.

## Why it matters

Reading an unfamiliar Compose file starts with "what is this project and what services does it define?". A consistent order means that question is always answered by the first lines, and it removes ordering from code review.

## Incorrect

```yaml
volumes:
  data: {}
services:
  web:
    image: nginx:1.27
name: shop
```

```
1:1  warn  Top-level key "volumes" should appear later (expected "name" at position 1)  top-level-order
```

## Correct

```yaml
name: shop
services:
  web:
    image: nginx:1.27
volumes:
  data: {}
```

## Options

### `order`

Type: `string[]`. Default: the order shown above.

Replaces the expected order. Keys not listed keep their relative position after the listed ones.

```json
{
  "rules": {
    "top-level-order": ["warn", { "order": ["services", "name", "volumes"] }]
  }
}
```

## Known limitations

- A flow mapping (`{name: x, services: {}}`) is reported but not fixed: reordering it would mean rewriting the line, which `--fix` does not do.
- Comment lines above a key travel with that key when it moves. A comment above the *first* key stays where it is, since it is usually a file header.

## Related

- [`service-key-order`](service-key-order.md) — the same idea inside each service.
