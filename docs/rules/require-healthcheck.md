# require-healthcheck

Long-running services should define a healthcheck.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

Skipped for [partial files](../configuration.md#partials) and for services that `extends` a definition in another file, where the healthcheck may live out of sight.

## What it does

Reports a service whose effective configuration has no `healthcheck` key. A healthcheck inherited through a merge key (`<<: *anchor`) or through `extends` within the same file satisfies the rule.

## Why it matters

Without a healthcheck, Docker considers a container healthy as soon as the process starts. Two things follow:

- `depends_on: { condition: service_healthy }` cannot be used, so dependent services start against a database that is still initialising.
- A process that is running but wedged (deadlocked, out of file descriptors, unable to reach its own dependencies) is never restarted, because nothing observes it.

An image that ships its own `HEALTHCHECK` instruction already satisfies Docker at runtime, but this rule cannot see inside the image — see the limitations.

## Incorrect

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4.2
```

```
3:5  warn  Service "api": no healthcheck defined  require-healthcheck
```

## Correct

```yaml
services:
  api:
    image: ghcr.io/acme/api:1.4.2
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

Inheriting one is also enough:

```yaml
x-defaults: &defaults
  healthcheck:
    test: ["CMD", "true"]
services:
  api:
    <<: *defaults
    image: ghcr.io/acme/api:1.4.2
```

## Options

### `exclude`

Type: `string[]`. Default: `[]`.

Service names that do not need a healthcheck — one-shot jobs, migration containers, sidecars that exit on purpose.

```json
{
  "rules": {
    "require-healthcheck": ["warn", { "exclude": ["migrate", "seed"] }]
  }
}
```

## Known limitations

- **A `HEALTHCHECK` baked into the image is invisible.** The rule reads the Compose file, not the image, so a service that is already checked at runtime is still reported. Use the `exclude` option or a suppression comment for those.
- Short-lived services are indistinguishable from long-running ones in a Compose file; the rule reports both.
- A service that extends a definition in **another file** is skipped entirely, because the healthcheck may be defined there.
- A `provider` service is skipped: it is handled by an external binary instead of a container, so Compose has nothing to health-check.

## Related

- [Compose file reference: healthcheck](https://docs.docker.com/reference/compose-file/services/#healthcheck)
