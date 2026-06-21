# Family Vault — Experience Standard (the premium / enterprise bar)

> **Why this exists.** Family Vault is not a pet project. It guards a family's most
> important data and will run for years, grow many features, and ship to **iOS and
> Android** (wrapped). Every feature must clear an **enterprise** bar (correct,
> secure, observable, resilient) *and* a **premium** bar (it should feel like a
> polished native app, not a web page). This document defines both bars in
> measurable terms. The **Experience Guardian** agent (`.claude/agents/
> experience-guardian.md`) audits each feature against it. `SHIPPING.md §5` is the
> per-PR gate; this is the deeper rubric behind it.

The test for every feature: **"Would a paying user of a top-tier consumer app
notice this is missing or worse here?"** If yes, it isn't done.

---

## 1. Native-app-feel checklist (the "it's an app, not a website" bar)

Applies to every screen. Most are enabled by the foundation in `src/index.css`
(native layer), `src/hooks/useGestures.ts`, and `src/lib/haptics.ts`.

- **Instant input.** No 300ms tap delay (`touch-action: manipulation` on controls).
  No zoom-jump when focusing inputs (≥16px on coarse pointers). Pinch-zoom stays
  (accessibility).
- **Gestures, not just clicks.** Lists support **swipe** for primary actions,
  **long-press** for a context/action sheet, **double-tap** for a quick action
  (e.g. favourite/reveal). Pull-to-refresh where a list is server-backed.
- **Haptics.** Selection, success, warning, error — on every committed action and
  gesture. (`haptic()`; no-ops on unsupported devices.)
- **Press feedback.** Pressable surfaces visibly respond (`.tappable` scale/opacity)
  within 120ms; respects reduced-motion.
- **App chrome, not browser chrome.** `display: standalone`; safe-area insets on
  every fixed element; status-bar color matches the screen; no horizontal body
  scroll ever; bottom-sheet & dialog patterns instead of browser `alert/confirm`.
- **Motion with meaning.** Page/route transitions, shared-element where it aids
  continuity, list enter/exit, optimistic UI on mutations. All ≤250ms, eased,
  reduced-motion-aware.
- **Offline & resilient.** Installable; meaningful offline state (never a dead white
  page); queued mutations where safe; "new version" prompt (no silent clobber).
- **Polish states.** Every async surface has skeleton → populated, a designed
  **empty** state (illustration + one clear CTA), and a **recoverable error** state
  (cause + retry) — never a raw spinner or thrown error.

---

## 2. Enterprise bar (every feature, no exceptions)

- **Correctness:** edge cases enumerated and tested (empty, max, concurrent edit,
  unauthorized actor, offline, slow net, partial failure).
- **Security/privacy:** authz checked server-side; least privilege; PII never logged;
  vault invariant (Worker never decrypts) upheld; sensitive reads audited; admin
  surfaces 404 to non-admins.
- **Observability:** mutations write an `audit_log` row; errors carry a `requestId`;
  no silent catches.
- **Resilience:** idempotent writes; optimistic-with-rollback; rate-limited; degrades
  when an optional binding (R2/Resend/Drive) is absent.
- **Data integrity:** explicit transactional multi-statement deletes (D1 cascades are
  advisory); migrations additive + reversible-by-design.
- **Accessibility (AA min):** keyboard reachable, visible focus, `aria-live` for async,
  labels on icon buttons, 200% zoom, both themes, Simple/Elder mode.

---

## 3. Per-feature deep-dive (beyond the obvious)

For each feature: the **enterprise cases** that make it real, and the **premium
touches** that make it feel exceptional.

### Secrets Vault (Phase 1 — headline)
- *Enterprise:* client-side crypto only; step-up (fresh passkey) to reveal high-sensitivity
  types; per-item escrow opt-out; key re-wrap on member add/remove; **lost-device recovery
  drill** (owner re-wrap) tested; clipboard auto-clear after N seconds; reveal + copy both
  audited; no secret in logs, URLs, or analytics; offline read of synced vault.
- *Premium:* long-press a row → action sheet (reveal / copy / edit / move); double-tap →
  reveal with haptic; masked-by-default with a tasteful reveal animation; password strength
  + breach-style hints on create; autofill-friendly; "copied" toast + haptic; per-type icons.

### Documents
- *Enterprise:* private-visibility enforced server-side; resumable large uploads with
  progress + retry; Drive throttle; orphaned-byte purge; version history; expiry reminders
  timezone-correct.
- *Premium:* swipe row → archive/trash; long-press → share/rename/move; PDF/image preview with
  pinch-zoom; drag-drop & camera capture on mobile; offline queue for uploads.

### Family / roles & invites
- *Enterprise:* owner cannot be demoted by others; invite tokens hashed + single-use +
  expiring; role changes audited; explicit cascade on member removal.
- *Premium:* avatars, presence of pending invites, inline role editing with confirm,
  shareable invite link with QR for in-person add.

### Activity / audit
- *Enterprise:* privacy-filtered feed; keyset pagination; security-severity filter; retention
  + R2 offload.
- *Premium:* grouped-by-day timeline, actor avatars, human sentences ("Dad revealed the wifi
  password"), filter chips, pull-to-refresh.

### Search
- *Enterprise:* blind-index (server never sees plaintext); client decrypt-and-search offline;
  never index secret values.
- *Premium:* instant as-you-type, recents, fuzzy, keyboard nav, voice entry, result grouping.

### Voice (Phase 3)
- *Enterprise:* on-device for secrets (never leave device); confirm-before-speak; audited;
  cloud fallback opt-in for non-secret only.
- *Premium:* live transcript + waveform, captions (HoH parity), big controls in Simple mode,
  graceful "didn't catch that" with the command menu.

### Generic modules (Phase 5)
- *Enterprise:* one validated `items` model; one reminder scan; per-type Zod; audited.
- *Premium:* each module gets a first-class card, icon, empty state, and the same gesture
  vocabulary "for free" via the shared primitives.

---

## 4. iOS / Android readiness (keep the door open from day one)

Target wrapper: **Capacitor** (reuses the exact PWA build; native shell + plugins). To
avoid a rewrite later, hold these invariants now:

- **No hard browser assumptions.** Feature-detect (`navigator.vibrate`, `SpeechRecognition`,
  WebAuthn, Clipboard). Centralize each behind a lib (`haptics.ts` is the template) so the
  native plugin swaps in one place.
- **Auth that survives a wrapper.** OAuth redirect/deep-link must work in a WebView /
  custom-tab; keep the session cookie scheme compatible (revisit for native: token in secure
  storage). Note this before Phase 1 ships passkeys — WebAuthn in a wrapped app needs the
  platform authenticator + associated-domains config.
- **WebCrypto only** for the vault (Capacitor WebView supports it) — no Node crypto.
- **Safe-area + notch** handled in CSS (already) so the native status bar/home indicator
  never overlaps.
- **Asset & deep-link strategy** documented before store submission (universal links →
  `/invites/:token`, `/vault/:id`).
- **No feature depends on a URL bar.** Back/forward must be in-app (nav + gestures).

> Decision deferred, not forgotten: confirm Capacitor wrapping before Phase 3 (voice) and
> Phase 1 (passkeys), since both have native-shell implications.

---

## 5. Performance & quality budgets

- **Load:** LCP < 2.5s on mid-tier mobile / 4G; TTI fast; route chunks code-split; initial JS
  lean (watch the dependency triangle — `CLAUDE.md §5`).
- **Interaction:** INP < 200ms; gesture/scroll at 60fps; optimistic UI so no mutation feels
  like a "page load."
- **Stability:** CLS < 0.1 (reserve space; skeletons match final layout).
- **Bundle:** justify every new dependency; prefer the existing primitives + inline SVG over a
  library (charts, date pickers).
- **Verify** with the `web-perf` skill / Lighthouse before declaring a feature premium-done.

---

## 6. "Premium done" definition (what the Guardian checks)

A feature is premium-done only when: enterprise bar (§2) ✓, native-feel checklist (§1) ✓ on
phone + desktop, per-feature touches (§3) present, iOS/Android invariants (§4) not violated,
budgets (§5) met, and `SHIPPING.md` gates green. Anything short ships as explicitly-tracked
follow-up, never as silent debt.
