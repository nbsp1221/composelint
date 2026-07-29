# Suppression comments

Turning a rule off in the configuration applies to the whole project. A suppression comment records a single, local exception where the exception belongs — next to the line that needs it.

Prefer a configuration change when a rule does not fit the project at all, and a comment when one line is a deliberate exception. Write down why.

## Syntax

```yaml
# composelint-disable-file                        all rules, whole file
# composelint-disable-file no-unbound-ports                 one rule, whole file
# composelint-disable-next-line no-privileged     the next content line
privileged: true  # composelint-disable-line no-privileged
# composelint-disable image-require-tag                      start of a range
# composelint-enable image-require-tag                       end of a range
```

Name one or more rules, separated by spaces or commas. Listing no rule at all suppresses every rule.

Everything after ` -- ` is a reason. It is ignored by the linter and read by the next person:

```yaml
# composelint-disable-file no-unbound-ports require-healthcheck -- local development stack only
```

Two spellings of each directive are accepted: the hyphenated form above (as in ESLint, Biome and oxlint) and a space-separated form (as in yamllint and dclint), with an optional `rule:` prefix:

```yaml
# composelint disable-line rule:no-unbound-ports
```

## What a line directive covers

A directive on its own line applies to the next content line; blank lines and other comments are skipped, so stacked directives all target the same line. A trailing directive applies to the line it sits on.

Both cover the target line **and everything indented under it**. That is why a comment above a key also covers the values of that key:

```yaml
services:
  web:
    image: nginx:1.27
    # composelint-disable-next-line no-unbound-ports -- public entry point
    ports:
      - "80:80"     # covered: indented under `ports:`
      - "443:443"   # covered
    expose:
      - "8080"      # not covered: back at the level of `ports:`
```

## Ranges

A `disable` directive applies from its own line until a matching `enable`, or to the end of the file if there is none. An `enable` without rule names closes everything a preceding `disable` opened.

```yaml
services:
  # composelint-disable image-require-tag -- vendor images we do not control
  legacy-a:
    image: vendor/a
  legacy-b:
    image: vendor/b
  # composelint-enable image-require-tag
  api:
    image: ghcr.io/acme/api:1.4.2   # checked again
```

## Fixes are suppressed too

A suppressed diagnostic never enters the result, so `--fix` does not apply its fix either. A file with

```yaml
version: "3.8"  # composelint-disable-line no-version-field
```

is left alone by `--fix`, and [`top-level-order`](rules/top-level-order.md) does not move the line.

## The name has no hyphen

The directive prefix is `composelint`, matching the command. `# compose-lint-disable-line` — the spelling the file being linted invites — is reported rather than ignored:

```
5:23  warn  Suppression comment "# compose-lint-disable-line" is not recognised — write "composelint-disable-line"  suppression
```

The rule the comment meant to suppress is still reported, so the file never looks clean because of a typo.

## Unused and mistyped directives are reported

A suppression that suppresses nothing is usually a directive in the wrong place or a stale exception. Those are reported as warnings under the `suppression` rule id:

```
6:5   warn  Unused suppression comment "# composelint-disable-next-line no-unbound-ports" — no diagnostics were suppressed  suppression
4:19  warn  Unknown rule "no-such-rule" in suppression comment — it suppresses nothing                                    suppression
6:3   warn  Suppression comment "composelint-enable" has no matching "composelint-disable"                         suppression
```

The first message is the one that usually matters: it means the directive did not cover the line you thought it did. Compare the line the diagnostic points at with the target described above.

## What cannot be suppressed

YAML parse errors (`parse-error`). A file that does not parse cannot be linted at all, and Compose will not read it either.

## Directives inside strings are not directives

Only real YAML comments count. Text that looks like a directive inside a quoted value or a block scalar is left alone:

```yaml
services:
  web:
    image: nginx:1.27
    command: echo "# composelint-disable-file"   # not a directive
    entrypoint: |
      # composelint-disable-line image-require-tag          # not a directive
      echo hi
```
