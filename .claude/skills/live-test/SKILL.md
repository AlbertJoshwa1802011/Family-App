---
name: live-test
description: Real-time application-level testing of Family Vault — run the dev server, seed multi-user sessions into local D1, drive real user journeys with curl, and capture mobile screenshots with Playwright. Use to verify features like a real family would experience them, or to review UI on a phone viewport.
---

# Live testing with real users (no mocks)

Unit/integration tests (`npm run test`) cover contracts. THIS flow exercises
the real workerd runtime + local D1 + the built UI, as actual users.

## 1. Boot + seed

```bash
npm run db:migrate:local                 # apply migrations to local D1 (once)
npm run dev -- --port 5199 &             # real workerd + HMR
sleep 12 && curl -s http://localhost:5199/api/health   # {"ok":true,...}
npm run dev:seed                         # creates Priya + Ravi with sessions
```

Sessions (Google OAuth can't run locally, so these are seeded directly):
- `Cookie: sid=sess-priya` — Priya Sharma
- `Cookie: sid=sess-ravi` — Ravi Sharma

Sessions idle-expire after 2h — re-run `npm run dev:seed` to refresh.

## 2. Drive the canonical family journey via curl

Do everything THROUGH the API (never insert app data directly — the journey is
the test). CSRF: send `-H "Origin: http://localhost:5199"` on mutations.

```bash
B=http://localhost:5199/api
# Priya creates the family
FAM=$(curl -s -X POST $B/families -H "Cookie: sid=sess-priya" \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5199" \
  -d '{"name":"The Sharma Family"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['family']['id'])")

# Docs: one family-visible, one private
curl -s -X POST $B/documents -H "Cookie: sid=sess-priya" -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5199" \
  -d "{\"familyId\":\"$FAM\",\"title\":\"Car insurance\",\"expiryDate\":\"2026-12-01\"}"
curl -s -X POST $B/documents -H "Cookie: sid=sess-priya" -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5199" \
  -d "{\"familyId\":\"$FAM\",\"title\":\"Private will\",\"visibility\":\"private\"}"

# Invite Ravi (token is email-bound to the invitee's account email!)
TOKEN=$(curl -s -X POST $B/families/$FAM/invites -H "Cookie: sid=sess-priya" \
  -H "Content-Type: application/json" -H "Origin: http://localhost:5199" \
  -d '{"email":"ravi@example.com","role":"member"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['invite']['token'])")
curl -s -X POST $B/families/invites/$TOKEN/accept -H "Cookie: sid=sess-ravi" \
  -H "Origin: http://localhost:5199"

# THE key assertion: Ravi must NOT see "Private will"
curl -s "$B/documents?familyId=$FAM" -H "Cookie: sid=sess-ravi" \
  | python3 -c "import sys,json;print([d['title'] for d in json.load(sys.stdin)['documents']])"

# Chat + @mention → Ravi gets a notification
curl -s -X POST $B/chat -H "Cookie: sid=sess-priya" -H "Content-Type: application/json" \
  -H "Origin: http://localhost:5199" -d "{\"familyId\":\"$FAM\",\"body\":\"@Ravi please renew it\"}"
curl -s "$B/notifications" -H "Cookie: sid=sess-ravi"
```

Extend the same way for: remind (`POST /documents/:id/remind`), search (`?q=`),
category suggestion (`POST /documents/suggest-category`), events + ICS
(`GET /events/:id/ics`), calendar feed (`POST /calendar/feed-token` then GET the
returned URL WITHOUT a cookie — it's a capability URL).

## 3. Screenshot the UI like a phone

```bash
npm i --no-save playwright-core          # if not installed
npm run dev:screenshots -- http://localhost:5199
```

Writes iPhone-viewport (390×844 @2x) PNGs of every screen to `screenshots/`
(gitignored). `SID=sess-priya` switches user; `CHROMIUM=/path` overrides the
browser binary (default `/opt/pw-browsers/chromium`).

**Look at the screenshots.** Check: bottom nav badges, empty states, spacing,
content scrolling under the translucent nav, safe-area padding.

## 4. Clean up

`pkill -f vite`. Local D1 state persists in `.wrangler/state/` (gitignored);
delete that directory for a fresh database.
