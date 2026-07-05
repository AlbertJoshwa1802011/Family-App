---
name: db-migration
description: Change the Family Vault database schema safely — edit the Drizzle schema, generate and validate the migration, and apply it locally and in production. Use for any table/column/index change.
---

# Database schema changes

`worker/db/schema.ts` is the SINGLE SOURCE OF TRUTH. Never hand-write or
hand-edit migration SQL to add columns.

## Workflow

```bash
# 1. Edit worker/db/schema.ts (check the import list — e.g. uniqueIndex
#    must be imported from drizzle-orm/sqlite-core before use).

# 2. Generate
npm run db:generate                      # → migrations/NNNN_<name>.sql

# 3. Validate (applies EVERY migration to a scratch DB in order)
python3 scripts/validate_migrations.py

# 4. Review the generated SQL — especially any table-recreation with
#    INSERT INTO ... SELECT (drizzle-kit bug: it can list NEW columns in the
#    copy; pre-production only, edit the INSERT to copy old columns and let
#    new ones take defaults, then re-validate).

# 5. Apply locally + run the full gate
npm run db:migrate:local
npm run test
```

## Production apply

Merging to the default branch triggers the deploy, but **migrations are NOT
applied automatically**. After a merge that includes a new migration:

```bash
npm run db:migrate:remote     # wrangler d1 migrations apply family-vault-db --remote
```

Features depending on the new tables 500 until this runs. Say this explicitly
in the PR body whenever a PR contains a migration.

## House schema conventions

- text UUID PKs (`crypto.randomUUID()` in app code); no autoincrement.
- Instants = unix-seconds integers with `.default(sql\`(unixepoch())\`)`;
  calendar dates = ISO `yyyy-mm-dd` text.
- Soft-delete pattern: `deletedAt integer` (comments, chat) or a
  `status` enum with `"trashed"` (documents, events).
- Dedupe tables (reminders_log, digest_log): UNIQUE index over the natural key +
  `onConflictDoNothing()` + check `res.meta.changes > 0` to claim atomically.
- D1 FK cascades are advisory — deletes that must cascade need explicit
  multi-statement app-code deletes plus a test.

## Test-harness note

Integration tests apply the real `migrations/*.sql` via `tests/helpers/testEnv.ts`
(node:sqlite adapter). New migrations are picked up automatically — if tests
fail with "no such table", re-run `npm run db:generate` and check the file
landed in `migrations/`.
