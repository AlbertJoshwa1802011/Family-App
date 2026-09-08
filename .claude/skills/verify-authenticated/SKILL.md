---
name: verify-authenticated
description: Verify Family Vault API features with a real session — never curl production and treat 401 as a feature failure. Use Vitest seedActor first; optional local D1 seed for HTTP. Invoke whenever implementing or checking any /api/* route that requires login.
---

# Verify authenticated APIs (stop 401 iteration)

**Hard rule:** A bare `curl https://fam.connect-cloud.workers.dev/api/...` returning
`401 unauthorized` proves **middleware works**, not that your feature is broken.
Do **not** open a “fix the 401” loop. Prove the feature in **Vitest** (or local
dev with a seeded `sid` cookie) before you touch production.

Production is closed-signup + Google OAuth. Agents cannot mint a real prod
session. The harness below is the intended path.

---

## Preferred path — Vitest + `seedActor` (no browser, no OAuth)

Integration tests call the Hono app in-process against a real in-memory SQLite
that applies every migration (`tests/helpers/testEnv.ts`).

### Template (copy for every new `/api/*` resource)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
  type TestEnv,
} from "./helpers/testEnv";

let t: TestEnv;
let familyId: string;
let owner: ReturnType<typeof seedActor>;
let outsider: ReturnType<typeof seedActor>;

beforeEach(() => {
  t = createTestEnv();
  const ownerUser = seedUser(t.sqlite);
  familyId = seedFamily(t.sqlite, ownerUser.id).id;
  owner = seedActor(t.sqlite, familyId, "owner", { name: "Olive Owner" });

  const otherOwner = seedUser(t.sqlite);
  const otherFamily = seedFamily(t.sqlite, otherOwner.id).id;
  outsider = seedActor(t.sqlite, otherFamily, "owner");
});

function req(method: string, path: string, cookie: string, body?: object) {
  return app.request(
    path,
    {
      method,
      headers: {
        Cookie: cookie, // "sid=<uuid>" from seedActor
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    t.env, // ← same DB the session row lives in (required)
  );
}

describe("my feature", () => {
  it("401 without session", async () => {
    const res = await app.request(
      `/api/my-thing?familyId=${familyId}`,
      { method: "GET" },
      t.env,
    );
    expect(res.status).toBe(401);
  });

  it("happy path with cookie", async () => {
    const res = await req(
      "GET",
      `/api/my-thing?familyId=${familyId}`,
      owner.cookie,
    );
    expect(res.status).toBe(200);
  });

  it("outsider cannot read (404, not 403)", async () => {
    const res = await req(
      "GET",
      `/api/my-thing?familyId=${familyId}`,
      outsider.cookie,
    );
    expect(res.status).toBe(404);
  });
});
```

### Minimum coverage every new route must ship with

| Case | Expect |
|---|---|
| No `Cookie` | `401` `{ error: "unauthorized" }` |
| Valid member | Happy path `200` / `201` |
| Invalid Zod body | `400` `{ error: "validation_error", issues }` |
| Other-family / outsider | `404` (do not leak) |
| Author-or-admin mutate rules | `403` where applicable |

Canonical examples: `tests/settlements.test.ts`, `tests/church-calendar.test.ts`,
`tests/expenses.test.ts`.

### Commands

```bash
# Fast loop while implementing (THIS is verification)
npx vitest run tests/<name>.test.ts

# Broader slices (optional)
npm run test:regression
npm run test:catalog

# Definition of done — before commit / PR / merge
npm run gate
```

---

## Optional path — local HTTP with `npm run dev:seed`

Use when you need curl / browser against `npm run dev` **without Google OAuth**.

```bash
npm run db:migrate:local
npm run dev:seed          # prints FAMILY_ID + Cookie: sid=... for two users
npm run dev               # another terminal
# then:
curl -s -H "Cookie: $OWNER_COOKIE" \
  "http://localhost:5173/api/settlements/summary?familyId=$FAMILY_ID"
```

`dev:seed` writes into **local** D1 only. It never touches production.

---

## Production smoke (after Deploy only)

| Check | Meaning |
|---|---|
| `GET /api/health` → `{"ok":true}` | Worker up |
| Auth-gated route without cookie → `401` | Middleware live (**expected**) |
| Feature works | Browser signed in as an approved user, **or** Vitest already proved it |

Do **not** use production 401 as a signal to rewrite the feature. If Vitest is
green and Deploy applied migrations, the remaining gap is usually signup /
secrets / browser session — not the handler.

---

## Anti-patterns (do not)

1. Curl production feature URLs and “fix the 401”.
2. Add a permanent unauthenticated “test mode” on production routes.
3. Skip writing `tests/<resource>.test.ts` because “I’ll check in the browser later”.
4. Treat `npm run test:ship` / `test:regression` as a substitute for `npm run gate`.

---

## Checklist before saying “verified”

- [ ] Focused Vitest file green (includes 401 + happy path + isolation)
- [ ] `npm run gate` green when committing
- [ ] If schema changed: migration generated + `validate_migrations.py` + Deploy log shows migration ✅
- [ ] Production curl 401 on the gated route is noted as **expected**, not a bug
