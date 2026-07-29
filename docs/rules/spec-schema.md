# spec-schema

The file must conform to the Compose Specification JSON schema.

| Preset | Severity |
| --- | --- |
| `recommended` | error |
| `strict` | error |

## What it does

Validates the whole file against the official [Compose Specification schema](https://github.com/compose-spec/compose-spec/blob/main/schema/compose-spec.json), which is vendored into this package. That covers two things a hand-written rule cannot keep up with:

- **Unknown keys** at every level — top level, services, `networks`, `volumes`, `secrets`, `configs`, `models`, and nested objects such as `deploy` or `build`.
- **Value types** — a key that exists but holds the wrong kind of value.

Anchors and merge keys are resolved first, so the merged result is what gets validated.

## Why it matters

Compose itself rejects unknown keys and wrong types. A typo like `restrat: always` does nothing at runtime and gives no hint why; `docker compose up` fails later with a schema error. Catching it while linting turns a deploy-time failure into a lint warning.

## Incorrect

```yaml
services:
  web:
    image: nginx:1.27
    ports: true # must be an array
    typo_key: 1 # not a Compose key
networks:
  back:
    drivr: bridge # typo, silently ignored by nothing — Compose rejects it
```

```
4:12  error  Service "web": "ports" must be an array                                        spec-schema
5:5   error  Service "web": unknown key "typo_key" is not part of the Compose Specification  spec-schema
8:5   error  Network "back": unknown key "drivr" is not part of the Compose Specification    spec-schema
```

## Correct

```yaml
services:
  web:
    image: nginx:1.27
    ports:
      - "127.0.0.1:8080:80"
    x-internal-note: anything # `x-` extension fields are always allowed
networks:
  back:
    driver: bridge
```

## Known limitations

- **The schema is a vendored copy.** Keys added to the specification after the copy was taken are reported as unknown until the copy is refreshed with `pnpm schema:update`. The provenance (upstream commit, date, checksum) is recorded in [`schemas/compose-spec.meta.json`](../../schemas/compose-spec.meta.json).
- **Interpolated keys are skipped.** `services: { ${SERVICE}: ... }` cannot be checked because Compose resolves the variable first.
- **Values behind `!reset` and `!override` are skipped.** These tags mark a placeholder, not data.
- Values are checked against the schema, not against Docker's runtime behaviour: a syntactically valid but nonsensical value passes.

## Related

- [Compose Specification](https://github.com/compose-spec/compose-spec/blob/main/spec.md)
- This rule replaced a hand-maintained key list. The rule it replaced, `unknown-key`, is gone.
