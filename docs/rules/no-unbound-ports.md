# no-unbound-ports

Published ports should be bound to a specific interface.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports a published port that is reachable on every interface of the host, which is the case when the host address is omitted or is a wildcard (`0.0.0.0`, `::`, `*`, or empty).

Both port syntaxes are checked:

| Entry | Reported | Why |
| --- | --- | --- |
| `"8080:80"` | yes | no host address, so Compose binds `0.0.0.0` |
| `"0.0.0.0:8080:80"` | yes | wildcard address written out |
| `"[::]:8080:80"` | yes | IPv6 wildcard |
| `"8000-8010:8000-8010"` | yes | ranges follow the same rule |
| `"8080"` or `8080` | yes | Docker assigns a host port and binds it to all interfaces |
| `{ published: "8080", target: 80 }` | yes | long syntax without `host_ip` |
| `{ published: "8080", host_ip: 0.0.0.0 }` | yes | wildcard `host_ip` |
| `"127.0.0.1:8080:80"` | no | bound to loopback |
| `"[::1]:8080:80"` | no | bound to IPv6 loopback |
| `{ published: "8080", host_ip: 127.0.0.1 }` | no | bound |
| `{ target: 80 }` | no | nothing published |

A `/tcp` or `/udp` suffix does not change the result. Inherited lists are included and marked `(inherited)`.

## Why it matters

`ports: ["5432:5432"]` on a laptop feels local, but on a server with a public interface it publishes the database to the internet, and Docker's own iptables rules bypass most host firewalls. Adding the interface makes the intent explicit and keeps the service reachable only where it should be — usually loopback, with a reverse proxy in front.

## Incorrect

```yaml
services:
  db:
    image: postgres:17
    ports:
      - "5432:5432"
```

```
5:9  warn  Service "db": port "5432:5432" is published on all interfaces (0.0.0.0)  no-unbound-ports
```

## Correct

```yaml
services:
  db:
    image: postgres:17
    ports:
      - "127.0.0.1:5432:5432"
```

Or do not publish at all — other services on the same Compose network can still reach it:

```yaml
services:
  db:
    image: postgres:17
    expose:
      - "5432"
```

A public-facing service is a deliberate exception. Record its exact public
surface in the linter configuration rather than weakening the rule for every
service:

```json
{
  "rules": {
    "no-unbound-ports": [
      "warn",
      {
        "allow": [
          {
            "service": "proxy",
            "published": ["80/tcp", "443/tcp", "443/udp"],
            "reason": "Public HTTP and HTTPS ingress"
          }
        ]
      }
    ]
  }
}
```

The Compose file can then keep the public mappings visible without linter
directives:

```yaml
services:
  proxy:
    image: nginx:1.27
    ports:
      - "80:80"
      - "443:443"
```

An inline suppression remains useful for a one-off exception, but a stable
network policy belongs in the linter configuration.

## Options

### `allow`

An array of public host-port allowances. Each entry has:

| Key | Required | Meaning |
| --- | --- | --- |
| `service` | yes | Exact Compose service name. |
| `published` | yes | Non-empty array of host ports in `<port-or-range>/<protocol>` form. |
| `reason` | no | Context for reviewers; it does not affect matching. |

The service, published host port and protocol must all match. The target
container port is deliberately not considered: `"8443:443"` is allowed by
`"8443/tcp"`, not by `"443/tcp"`. The short and long Compose syntaxes behave
the same, and a missing protocol means `tcp`.

Allowances are exact. An allowance for `443/tcp` does not cover `443/udp`, a
different service, or a new port on the same service. A published range is
written as a range, for example `8000-8010/tcp`.

The container-only short syntax (`"3000"`) asks Docker to choose the published
host port at runtime. Because that port is unknown during linting, it cannot
match an allowance; bind a known host port explicitly if it is an approved
public surface.

An `allow` entry applies to every linted file containing that exact service
name. In a repository with unrelated Compose projects that reuse service names,
place a separate composelint configuration at each project root.

## Known limitations

- Whether "all interfaces" is actually dangerous depends on the host. On a single-interface development machine it may be fine; the rule cannot know, which is why it defaults to a warning.
- An uninterpolated variable in place of the whole list (`ports: ${PORTS}`) is reported as a type problem by [`spec-schema`](spec-schema.md), not here.
- A dynamically assigned host port cannot be allowlisted because its number is not known until the service starts.

## Related

- [`no-host-network`](no-host-network.md)
- [Compose file reference: ports](https://docs.docker.com/reference/compose-file/services/#ports)
