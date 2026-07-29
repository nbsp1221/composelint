## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Checks

- [ ] The title follows the [gitmoji](https://gitmoji.dev) convention — it
      becomes the commit message on `main`
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test:all` pass
- [ ] A test covers the change — for a bug fix, one that fails without it
- [ ] For a new or changed rule: the doc under `docs/rules/` and the table in
      `README.md` are updated, and `CHANGELOG.md` has an entry under
      `Unreleased`

<!--
For a rule change, the useful thing to include is a file that must stay quiet.
Anything that turns a legitimate Compose file into a diagnostic is a regression,
even when the new report is technically correct.
-->
