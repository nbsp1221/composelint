# image-require-tag

Images should use an explicit tag instead of an implicit `latest`.

| Preset | Severity |
| --- | --- |
| `recommended` | warn |
| `strict` | error |

## What it does

Reports an `image` reference that either carries no tag at all or uses a moving tag. The default set of moving tags is `latest`, `stable`, `edge` and `canary`, compared case-insensitively.

A digest counts as pinned, with or without a tag:

| Reference | Reported |
| --- | --- |
| `nginx` | yes — no tag, Docker resolves `latest` |
| `nginx:latest` | yes |
| `registry.example.com:5000/app` | yes — the registry port is not a tag |
| `nginx:1.27` | no |
| `nginx@sha256:…` | no |
| `nginx:1.27@sha256:…` | no |
| `nginx:${TAG}` | no — the tag is supplied at runtime |
| `${IMAGE}` | no — the reference may already carry a tag |
| `${REGISTRY}/app` | yes — a tag is missing regardless of the variable |

Inherited values are included and marked `(inherited)`.

## Why it matters

`latest` is a mutable pointer. The same file produces different containers depending on when it is pulled, which makes a deployment non-reproducible and turns "it worked yesterday" into an unanswerable question. It also breaks rollback: there is no earlier tag to go back to.

Pinning a tag makes upgrades explicit and reviewable. Pinning a digest makes them exact.

## Incorrect

```yaml
services:
  web:
    image: nginx
  cache:
    image: redis:latest
```

```
3:12  warn  Service "web": image "nginx" has no explicit tag (defaults to "latest")  image-require-tag
5:12  warn  Service "cache": image "redis:latest" uses implicit tag "latest"         image-require-tag
```

## Correct

```yaml
services:
  web:
    image: nginx:1.27-alpine
  cache:
    image: redis@sha256:aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990
  api:
    image: ghcr.io/acme/api:${API_VERSION}
```

## Options

### `forbiddenTags`

Type: `string[]`. Default: `["latest", "stable", "edge", "canary"]`.

Replaces the set of tags treated as moving. Comparison is case-insensitive.

```json
{
  "rules": {
    "image-require-tag": ["warn", { "forbiddenTags": ["latest", "main", "dev"] }]
  }
}
```

## Known limitations

- A version-like tag that is actually mutable (`nginx:1`, `nginx:stable-alpine`) is not reported unless you list it in `forbiddenTags`.
- The rule does not require a digest; a tag is enough to satisfy it.
- **A service that also declares `build` is skipped.** Compose then builds the image and applies `image` as the tag for the result, so the reference names a local artifact rather than a dependency pulled from a registry — `image: myapp-local` next to `build: .` is the documented way to name a build. Reproducibility for such a service comes from the Dockerfile, not from the tag.
- A service with no `image` at all is not reported here.

## Related

