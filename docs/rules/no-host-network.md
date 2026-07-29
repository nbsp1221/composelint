# no-host-network

Services should not use host network mode.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports a service whose effective `network_mode` is `host`. Inherited values (merge keys, `extends`) are included and marked `(inherited)`.

## Why it matters

`network_mode: host` removes the container's own network namespace. The service shares the host's interfaces, which means:

- `ports:` is ignored — every port the process opens is reachable on the host, including ones you did not intend to publish.
- The container can reach services bound to `127.0.0.1` on the host, bypassing network policy.
- Container-to-container isolation and Compose's own DNS names no longer apply.

It is the right choice for a few workloads (network probes, some VPN or monitoring agents). For everything else, publishing a port on an explicit interface achieves the goal with a fraction of the exposure.

## Incorrect

```yaml
services:
  probe:
    image: monitor:1.4
    network_mode: host
```

```
4:19  warn  Service "probe": host network mode bypasses network isolation  no-host-network
```

## Correct

```yaml
services:
  probe:
    image: monitor:1.4
    ports:
      - "127.0.0.1:9100:9100"
```

Other values are not reported:

```yaml
    network_mode: bridge
    # or
    network_mode: container:other-service
    # or
    network_mode: none
```

## Known limitations

- An uninterpolated variable (`network_mode: ${NET}`) is not reported.
- `pid: host`, `ipc: host` and `uts: host` share the same namespace concern but are not checked by this rule.

## Related

- [`no-unbound-ports`](no-unbound-ports.md) — the narrower version of the same exposure problem.
