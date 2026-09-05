---
name: gate
description: Run Family Vault's definition-of-done gate before any commit — typecheck, lint, tests, build, and (when the schema changed) migration generation + validation. Use before committing, when asked "is it green", or after any multi-file change.
---

# The Gate — definition of done

Every change must pass ALL of these before it can be committed. No exceptions,
no "it's just docs" shortcuts for code changes.

```bash
npm run typecheck   # tsc project refs + worker tsconfig + node tsconfig
npm run lint        # eslint flat config (incl. react-hooks/purity)
npm run test        # vitest — 358 tests across 23 files, ALL must pass
npm run build       # tsc -b && vite build (catches PWA/plugin/worker breakage)
```

If `worker/db/schema.ts` was touched, additionally:

```bash
npm run db:generate                       # drizzle-kit generates migrations/NNNN_*.sql
python3 scripts/validate_migrations.py    # applies ALL migrations to a scratch DB
```

## Interpreting failures

- **typecheck error in `src/`** but the code is worker-side (or vice versa):
  check you edited the right tsconfig project — there are three.
- **Test failure with 500s in integration tests**: usually a drizzle query whose
  selected columns have duplicate result names — the node:sqlite D1 adapter
  maps rows positionally. Alias one side:
  `sql<string>\`${schema.families.name}\`.as("family_name")`.
- **Lint `react-hooks/purity`**: never call `Date.now()` in render — use
  `const [now] = useState(() => Math.floor(Date.now() / 1000))`.
- **Build fails but typecheck passed**: usually the vite plugin triangle — do
  NOT bump `vite`/`@cloudflare/vite-plugin`/`vite-plugin-pwa`/`@vitejs/plugin-react`
  independently (see CLAUDE.md §5).

## When the gate is green

Commit with a conventional subject (`feat:`/`fix:`/`security:`/`docs:`/`test:`)
and a body explaining the why. Then see the `release` skill for push/PR/deploy.
