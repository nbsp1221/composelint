# no-conflicting-published-ports

Services should avoid conflicting static host-port bindings.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports a static binding on a later service when an earlier service in the same
file publishes the same host port and protocol on an overlapping host address.
It checks single literal ports from 1 through 65535 in short or long syntax.
TCP is the default. UDP and SCTP are compared separately.

IPv4 and IPv6 are checked separately. Within either family a wildcard overlaps
specific addresses, and different specific addresses do not overlap. An omitted
address assumes Docker's default IPv4 wildcard binding.

The rule uses effective YAML and same-file `extends` values, including resets.
It skips [partial files](../configuration.md#partials), services with nonempty
or unresolved profiles, services delegated to a provider, host-network services,
and services whose inheritance depends on an external file.

## Why it matters

An overlapping host binding can prevent two services from starting together.
The right correction depends on which service should own the port, so this
rule does not change the file.

## Incorrect

```yaml
services:
  web:
    image: nginx:1
    ports: ["127.0.0.1:8080:80"]
  admin:
    image: nginx:1
    ports: ["127.0.0.1:8080:80"]
```

## Correct

```yaml
services:
  web:
    image: nginx:1
    ports: ["127.0.0.1:8080:80"]
  admin:
    image: nginx:1
    ports: ["127.0.0.1:8081:80"]
```

## Known limitations

- Omitted or zero published ports are dynamically assigned. The rule skips them
  along with ranges, interpolated mappings, and `expose`.
- Short ranges can reserve multiple ports. A long-syntax published range can
  allocate one available port. Neither form is compared.
- The rule compares distinct services in one file. It does not inspect the
  Docker daemon, host network, dual-stack behavior, or runtime profile selection.
