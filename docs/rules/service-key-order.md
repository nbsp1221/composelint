# service-key-order 🔧

Keys within each service should follow a specific order.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

🔧 Fixable with `--fix`.

## What it does

Checks that the keys of every service appear in a fixed order. All 93 service keys the Compose Specification defines are placed in one of eleven groups, so no key is ever left to sort arbitrarily:

| Group | Keys |
| --- | --- |
| Inheritance | `extends` |
| Identity | `image`, `build`, `provider`, `platform`, `pull_policy`, `pull_refresh_after`, `container_name` |
| Activation | `profiles`, `depends_on`, `links`, `external_links` |
| Execution | `command`, `entrypoint`, `working_dir`, `user`, `group_add`, `init`, `tty`, `stdin_open`, `attach`, `restart`, `stop_signal`, `stop_grace_period`, `pre_start`, `post_start`, `pre_stop` |
| Configuration | `env_file`, `environment`, `label_file`, `labels`, `annotations`, `configs`, `secrets`, `credential_spec`, `models` |
| Networking | `ports`, `expose`, `networks`, `network_mode`, `hostname`, `domainname`, `extra_hosts`, `dns`, `dns_opt`, `dns_search`, `mac_address` |
| Storage | `volumes`, `volumes_from`, `tmpfs`, `shm_size`, `storage_opt`, `devices`, `device_cgroup_rules` |
| Observability | `healthcheck`, `logging` |
| Resources | `deploy`, `scale`, `gpus`, the `cpu*` and `mem*` limits, `oom_*`, `pids_limit`, `blkio_config`, `ulimits`, `cgroup`, `cgroup_parent` |
| Security | `privileged`, `read_only`, `cap_add`, `cap_drop`, `security_opt`, `sysctls`, `userns_mode`, `use_api_socket`, `ipc`, `pid`, `uts`, `isolation`, `runtime` |
| Development | `develop` |

Merge keys (`<<`), `x-*` extension fields, and keys the Compose Specification does not define are pinned. They do not participate in ordering comparisons; when `--fix` reorders known keys, pinned entries stay together in their original relative order. An invalid key has no meaningful position, [`spec-schema`](spec-schema.md) already reports it, and an `order` option cannot change this — listing a key does not make it real.

## Why it matters

There is no single community convention here — a scan of the official [awesome-compose](https://github.com/docker/awesome-compose) samples shows `image`/`build` first and little agreement after that. The value is not in the specific order but in having one: identity first, then how the service starts, then what it talks to, then how much of the host it may use, with privileges grouped so a reviewer can scan them together.

## Incorrect

```yaml
services:
  web:
    ports:
      - "127.0.0.1:8080:80"
    image: nginx:1.27
```

```
3:5  warn  Service "web": key "ports" is out of order (expected "image" at position 1)  service-key-order
```

## Correct

```yaml
services:
  web:
    image: nginx:1.27
    ports:
      - "127.0.0.1:8080:80"
```

## Options

### `order`

Type: `string[]`. Default: the flattened group order above.

Replaces the expected order. Keys not listed keep their relative position after the listed ones, so a short list is enough to pin only what you care about:

```json
{
  "rules": {
    "service-key-order": ["warn", { "order": ["image", "build", "restart"] }]
  }
}
```

An empty array (`[]`) disables the ordering check without turning the rule off.

## Known limitations

- A service written as a flow mapping (`web: {image: nginx, ports: []}`) is reported but not fixed.
- The fix moves whole lines. A comment directly above a key travels with it; a comment separated by a blank line belongs to the key that follows it.

## Related

- [`top-level-order`](top-level-order.md)
