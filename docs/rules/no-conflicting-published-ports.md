# no-conflicting-published-ports

Services should avoid conflicting static host-port bindings.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports a static binding on a later service when an earlier service in the same
file publishes the same host port and protocol on an overlapping host address.
It checks single literal ports from 1 through 65535 in short or long syntax,
and short mappings with equal-length host and container ranges, such as
`"8080-8082:80-82"`. Range endpoints are inclusive. Host port zero is
dynamically allocated, including when it is the first member of a short range.
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

- The rule skips omitted or dynamic published ports, interpolated mappings,
  `expose`, and invalid ranges.
- A host range with one target can allocate a single available port. The rule
  skips these allocation pools, including long-syntax published ranges.
- The rule compares distinct services in one file. It does not inspect the
  Docker daemon, host network, dual-stack behavior, or runtime profile selection.
