# no-cap-add-all

Services should not add ALL capabilities.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports any `cap_add` entry equal to `ALL`, in any letter case. Inherited lists (merge keys, `extends`) are included and marked `(inherited)`.

## Why it matters

Docker starts a container with a restricted capability set. `cap_add: [ALL]` hands back everything that was withheld, including `SYS_ADMIN` (mount, namespace manipulation), `SYS_PTRACE` (inspect other processes) and `SYS_MODULE` (load kernel modules). The result is close to `privileged: true` while looking like a smaller change in review.

Adding the one capability a service actually needs keeps the rest withheld.

## Incorrect

```yaml
services:
  app:
    image: app:1.0
    cap_add:
      - ALL
```

```
5:9  warn  Service "app": cap_add includes ALL, which is equivalent to privileged mode  no-cap-add-all
```

Lower case is reported too:

```yaml
    cap_add: ["all"]
```

## Correct

```yaml
services:
  app:
    image: app:1.0
    cap_add:
      - NET_ADMIN
      - SYS_TIME
```

Dropping everything first and adding back what is needed is stronger still:

```yaml
services:
  app:
    image: app:1.0
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
```

## Known limitations

- Individual dangerous capabilities (`SYS_ADMIN`, `SYS_PTRACE`, …) are not reported — only `ALL`.
- A missing `cap_drop: [ALL]` is not reported; this rule only looks at what is added.

## Related

- [`no-privileged`](no-privileged.md)
- [Docker: runtime privilege and Linux capabilities](https://docs.docker.com/reference/cli/docker/container/run/#privileged)
