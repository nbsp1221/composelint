# Security Policy

## Supported versions

composelint is pre-1.0 and maintained by one person. Only the latest release
receives fixes; there are no backports.

## Reporting a vulnerability

Report privately through GitHub: open the
[Security tab](https://github.com/nbsp1221/composelint/security/advisories/new)
and choose *Report a vulnerability*. Please do not open a public issue for
anything you believe is exploitable.

Include the Compose file or configuration that triggers it, the composelint
version (`composelint --version`) and what you expected to happen. Expect a
first reply within a week; a fix ships as a patch release, and the advisory is
published once it is out.

## What counts

composelint reads files and writes files. A report is in scope when it shows
composelint doing something a linter should never do, for example:

- executing content from a Compose file, a configuration file or a rule option;
- writing outside the file being fixed, or corrupting a file that `--fix`
  touched;
- reading a path that the configuration excludes, or following a symlink out of
  the project;
- crashing or hanging on input small enough to arrive in a pull request.

A **missed security problem in a Compose file is not a vulnerability in
composelint** — that is a rule request or a bug, and a public issue is the
right place for it. The
[scope of the security rules](README.md#scope-of-the-security-checks) explains
what the rules do and do not cover.
