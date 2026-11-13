# no-duplicate-container-names

Services should use distinct literal container names.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports each later service that has the same case-sensitive, literal
`container_name` as an earlier service in the same file. The rule reads
effective values from YAML merges and same-file `extends`, including resets.
It skips [partial files](../configuration.md#partials), services with
nonempty or unresolved profiles, services delegated to a provider, and services
whose inheritance depends on an external file. Interpolated names are unknown.

## Why it matters

Docker needs distinct names for containers on the same daemon. Reusing a fixed
name can prevent both services from starting together. Removing an unnecessary
`container_name` lets Compose assign the name. The rule leaves this choice to
the author.

## Incorrect

```yaml
services:
  web:
    image: nginx:1
    container_name: shared
  admin:
    image: nginx:1
    container_name: shared
```

## Correct

```yaml
services:
  web:
    image: nginx:1
  admin:
    image: nginx:1
```

## Known limitations

The rule compares explicit names in one file. It cannot check names generated
by Compose or names already in use on the Docker daemon. Profile-gated
services may still collide if started together.
