# no-version-field 🔧

The top-level `version` field is obsolete and should be removed.

| Preset | Severity |
| --- | --- |
| `recommended` | **error** |
| `strict` | error |

🔧 Fixable with `--fix`.

## What it does

Reports a top-level `version` key and, with `--fix`, deletes its line.

## Why it matters

`version` belonged to the legacy Compose file formats (v2, v3), where it selected a schema. The Compose Specification dropped it: the field is parsed and ignored. The specification's own schema marks it as

> declared for backward compatibility, ignored. Please remove it.

Keeping it suggests the file targets a format that no longer exists, and it misleads readers into thinking features are gated by it. This is one of only two rules that default to `error`, because there is no situation where the field does something.

## Incorrect

```yaml
version: "3.8"
name: shop
services:
  web:
    image: nginx:1.27
```

```
1:1  error  Top-level "version" field is obsolete in modern Compose and should be removed  no-version-field
```

## Correct

```yaml
name: shop
services:
  web:
    image: nginx:1.27
```

## Known limitations

- A `version` inside a flow mapping (`{version: "3.8", services: {}}`) is reported but not fixed.
- Comment lines above `version:` are left alone when the key is deleted, because the parser attaches a file header comment to the first key.

## Related

- If you deliberately keep the field, turn this rule off. [`top-level-order`](top-level-order.md) then leaves `version` wherever you put it instead of moving it.

```json
{ "rules": { "no-version-field": "off" } }
```
