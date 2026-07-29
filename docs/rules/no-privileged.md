# no-privileged

Services should not run in privileged mode.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports a service whose effective configuration sets `privileged: true`, including the quoted form `"true"` that Compose also accepts.

Values inherited through a merge key (`<<: *anchor`) or through `extends` count as well; the diagnostic then points at the line that brought them in and the message ends with `(inherited)`.

## Why it matters

`privileged: true` disables nearly every container isolation mechanism at once: the container gets all capabilities, unrestricted device access, and can modify kernel parameters. A process that escapes the application layer is effectively root on the host.

It is occasionally necessary (Docker-in-Docker, some hardware access). Because it is legitimate but dangerous, the default severity is a warning and the exception is meant to be recorded in the file:

```yaml
    privileged: true # composelint-disable-line no-privileged -- dind needs it
```

## Incorrect

```yaml
services:
  runner:
    image: docker:27-dind
    privileged: true
```

```
4:17  warn  Service "runner": privileged mode grants full access to the host  no-privileged
```

Also reported, because Compose treats the string as enabled:

```yaml
    privileged: "true"
```

Also reported — the value is inherited:

```yaml
x-privileged: &privileged
  privileged: true
services:
  runner:
    <<: *privileged
    image: docker:27-dind
```

```
5:9  warn  Service "runner": privileged mode grants full access to the host (inherited)  no-privileged
```

## Correct

```yaml
services:
  app:
    image: nginx:1.27
    cap_add:
      - NET_ADMIN # grant only what is needed
```

```yaml
services:
  app:
    image: nginx:1.27
    privileged: false
```

## Known limitations

- An uninterpolated variable (`privileged: ${PRIVILEGED}`) is not reported: the value is unknown until Compose resolves it.

## Related

- [`no-cap-add-all`](no-cap-add-all.md) — `cap_add: [ALL]` grants a comparable level of access.
- [OWASP Docker Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)
