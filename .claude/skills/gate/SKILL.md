---
name: gate
description: >
  Run Family Vault's definition-of-done gate before any commit, PR, or "is it
  green" check. Use after any multi-file change, and whenever asked if tests
  pass. typecheck + lint + full vitest + build; plus migration validation if
  the schema changed.
---

# Gate — definition of done

This skill is **mandatory**. Do not commit, open a PR, or call a change done
until it passes. Focused slices (`npm run test:ship`, `npm run test:regression`)
are for local iteration only.

## Run

```bash
npm run gate
```

That is `typecheck` + `lint` + **full** `npm test` (511 tests, 37 files) + `build`.
Alias: `npm run test:gate`. GitHub CI and production deploy already run `npm run gate`.

If you edited `worker/db/schema.ts` or generated SQL:

```bash
npm run db:generate
python3 scripts/validate_migrations.py
```

## Rules

1. Failures are blockers. Do not wave through a pre-existing red test as "not mine."
2. `npm run test:ship` and `npm run test:regression` are **not** the gate.
   Ship = Home / tasks / Contacts / Face ID / cron / email / upload.
   Regression = events / church / expenses / calendar / bubble nav.
3. New behavior needs a test in the matching `tests/<area>.test.ts` (or a new
   file). See `CLAUDE.md §7` and `docs/TESTING.md`.
4. Do not skip the gate because the change "is docs only" unless you are sure
   no executable file moved — still run `npm run gate` when in doubt.

## After it is green

Commit with a conventional subject (`feat:`, `fix:`, `test:`, `docs:`, `security:`).
See `docs/SHIPPING.md`.
