---
name: release
description: Ship Family Vault changes — commit conventions, push, PR, merge-to-deploy pipeline, post-deploy migration + smoke test. Use when committing, opening a PR, merging, or verifying a production deployment.
---

# Releasing changes

## Pipeline shape

- Development happens on a feature branch (currently
  `claude/app-testing-deployment-plan-nb9685`).
- CI (`.github/workflows/ci.yml`) runs typecheck + lint + migration
  validation + tests + build on every push.
- **Merging a PR into the default branch (`claude/family-vault-pwa-plan-TrvxG`)
  triggers the production deployment** (owner's Cloudflare pipeline).
- Do NOT merge without the user's go-ahead unless they already gave it.

## Before pushing

Run the `gate` skill. Commit style: conventional subjects
(`feat:` / `fix:` / `security:` / `docs:` / `test:`), body explains the WHY and
lists notable changes. Never commit secrets, `.dev.vars`, `*.tsbuildinfo`,
`screenshots/`, or `.wrangler/`.

```bash
git push -u origin <branch>    # retry w/ backoff only on network errors
```

## PR checklist

- Lead with what a reviewer must know: user-visible changes, security-relevant
  changes, test delta ("N → M tests, all green").
- **If the PR contains a migration, say so in bold** and include the
  post-merge step (below).

## After a merge that includes a migration

```bash
npm run db:migrate:remote
```

Migrations are NOT applied by the deploy. New-table features 500 until this runs.

## Post-deploy smoke test

```bash
curl -s https://<domain>/api/health                    # {"ok":true,...}
curl -s https://<domain>/api/nope                      # JSON not_found, NOT HTML
curl -s -X POST https://<domain>/api/families \
  -H "Origin: https://evil.example" -d '{}'            # {"error":"csrf_rejected"}
```

Then in a browser: sign in, send a chat message (proves migrations applied),
add a document with an expiry date.

## After the PR is merged

The branch is finished — restart it from the default branch for follow-up work:

```bash
git fetch origin claude/family-vault-pwa-plan-TrvxG
git checkout -B <branch> origin/claude/family-vault-pwa-plan-TrvxG
git push -u origin <branch> --force-with-lease
```
