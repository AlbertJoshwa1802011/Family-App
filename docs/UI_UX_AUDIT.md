# Family Vault — Mobile UI/UX Audit

Audited: 2026-06-07. Stack: React 19, React Router 7, Tailwind v4 (`@theme`), vite-plugin-pwa. Target: mobile-first, premium app-like feel. Today the app is a basic dark web page: top horizontal tab nav, emoji icons, no skeletons, no safe-area handling, undersized tap targets, flat surfaces.

---

## 1. Design-system foundations (P0)

**Color & dark theme.** Current `@theme` has only 2 vault shades + 2 ink shades, and base text `#e2e8f0` is hardcoded in `body`. Fill out the ramp so surfaces, borders, and states are tokens, not ad-hoc `white/10`:

```css
@theme {
  --color-vault-50:#f0fdfa; --color-vault-400:#2dd4bf; --color-vault-500:#14b8a6;
  --color-vault-600:#0d9488; --color-vault-700:#0f766e;
  --color-ink-950:#070b14; --color-ink-900:#0b1220; --color-ink-800:#111a2e;
  --color-ink-700:#1a2540; --color-surface:#111a2e; --color-surface-2:#16213c;
  --color-border:#ffffff14; --color-fg:#e2e8f0; --color-fg-muted:#94a3b8;
  --color-success:#34d399; --color-warning:#fbbf24; --color-danger:#f87171;
  --radius-card:16px; --radius-pill:9999px;
  --shadow-card:0 1px 2px #0006,0 8px 24px -12px #0009;
  --shadow-sheet:0 -8px 40px -8px #000a;
}
```

Use a single elevated `bg-surface` for cards (not transparent over body). Reserve `vault` for primary/active only. Add `warning`/`danger` for expiry states (this is an expiry-tracking app — color-coding is core).

**Typography.** Add a real scale and adopt Inter (variable, self-hosted woff2 — matches PWA `woff2` glob). Tokens: display 28/700, h1 22/600, h2 18/600, body 15/400, label 13/500, caption 12. Add `-webkit-font-smoothing:antialiased` and `text-rendering:optimizeLegibility`.

**Spacing/radius.** Keep Tailwind 4px base; standardize page padding `px-4`, card padding `p-4`, card radius `rounded-2xl` (16px), pills `rounded-full`. Mobile content max-width `max-w-md` centered (currently `max-w-5xl` — too wide, looks like a desktop site stretched).

**Motion.** Add transition tokens: `--ease-out:cubic-bezier(.22,1,.36,1)`, durations 150/250ms. Tap feedback via `active:scale-[.97] transition-transform`. Sheets slide up, toasts fade+rise. All gated by `prefers-reduced-motion`.

**Component primitives to build** (`src/components/ui/`): `Button` (variants primary/secondary/ghost/danger, `min-h-11`), `Card`, `Input`, `Badge` (expiry status), `EmptyState` (icon+title+body+CTA), `Skeleton` (shimmer), `Sheet`/`Modal` (bottom-sheet on mobile), `Toast`, `AppBar` (sticky), `BottomNav`, `Avatar`, `ListItem` (icon + title + meta + chevron). These replace the repeated inline `rounded-xl border border-white/10` boilerplate across every page.

---

## 2. Mobile-specific issues (P0/P1)

- **P0 — Replace top tab nav with a fixed bottom nav.** `Layout.tsx` uses a horizontal `overflow-x-auto` tab strip — unreachable by thumb and un-app-like. Build `BottomNav`: 4 items (Dashboard/Documents/Family/Settings), `fixed inset-x-0 bottom-0`, icon + label, `bg-ink-900/90 backdrop-blur`, top border. Each item `min-h-14 flex-1`. Add `pb-[env(safe-area-inset-bottom)]`. Give `<main>` `pb-24` so content clears it.
- **P0 — Safe-area insets.** `viewport-fit=cover` is set in `index.html` but no `env(safe-area-inset-*)` is used anywhere. Apply to AppBar (`pt-[env(safe-area-inset-top)]`), BottomNav, FAB, and toast.
- **P0 — Touch targets.** Login `py-3` is OK; but Documents "+ Add" (`py-1.5`), nav links (`py-1.5`), Settings sign-out (`py-1.5`) are ~28px tall — below the 44px minimum. Enforce `min-h-11` (44px) on all interactive elements.
- **P1 — Sticky AppBar.** Make the header `sticky top-0 z-20 bg-ink-900/80 backdrop-blur` with safe-area top padding; show contextual title per route.
- **P1 — FAB for Add document.** Move the Documents "+ Add" action to a floating action button: `fixed bottom-20 right-4`, `size-14 rounded-full bg-vault-600 shadow-card`, above the bottom nav + safe area. Primary creation lives in the thumb zone.
- **P1 — No horizontal overflow / overscroll.** Add `overflow-x-hidden` on root and `overscroll-behavior-y:contain` to prevent rubber-band bleed; `-webkit-tap-highlight-color:transparent`.
- **P1 — Scroll behavior.** Single scroll container, momentum scrolling, scrollbar-gutter stable.

---

## 3. Page-by-page review

**Login.** Functional but plain. Emoji 🗄️ / 🔐 → branded SVG logo mark + Google "G" SVG. Center vertically with safe-area-aware padding. Add subtle radial/gradient backdrop behind the logo for premium feel. Disabled state should show a spinner, not just `opacity-50`. Footer "Phase 0 scaffold" copy should be muted caption. Button: full-width on mobile (`w-full max-w-xs`).

**Dashboard.** `StatCard` shows "—" placeholders with no loading state. Improvements: add Skeleton cards while loading; give each stat an icon + accent color (Documents=vault, Expiring=warning, Storage=info). Add a greeting header ("Hi, Albert"). The dashed "coming soon" box is dev scaffolding — replace with a proper `EmptyState` (icon, title, subtitle). 2-col grid is good on mobile; ensure equal heights and `tabular-nums` on values.

**Documents.** Loading is bare "Loading…" text → render 5–6 `Skeleton` `ListItem`s. Each row is title + tiny category text; upgrade to `ListItem`: category icon avatar, title (truncate), category as a `Badge`, **expiry badge** (green/amber/red from `expiryDate`), trailing chevron. Empty state → proper `EmptyState` with illustration + "Add document" CTA. Move "+ Add" to FAB. Consider a category filter chip row (horizontal scroll) and search.

**DocumentDetail.** Just a title + dashed box. Needs: AppBar with real back chevron (44px hit area) + document title, a hero card (category icon, title, expiry badge, owner avatar), action row (View file / Download / Edit / Delete as `Button`s), and a metadata `ListItem` group (created, updated, versions). Add a Skeleton detail state and a not-found/error state.

**Family.** Placeholder only. Build: member list using `Avatar` + name + role `Badge`, an "Invite member" primary button, pending-invites section. Empty state with CTA.

**Settings.** Email shown as plain text; "Sign out" is a tiny low-contrast outline button. Improvements: group into labeled `Card` sections (Account, Notifications, About). Show `Avatar` + name + email as a header row. Sign-out → full-width `danger`/secondary `Button` `min-h-11`. Add app version + a reminder-prefs placeholder card.

---

## 4. Accessibility & polish

- **Focus states:** nothing custom — add `focus-visible:ring-2 ring-vault-400 ring-offset-2 ring-offset-ink-900` to all interactive primitives.
- **Contrast:** `text-slate-500` on `ink-900` (~3:1) fails AA for body text; promote muted text to `--color-fg-muted` (#94a3b8, ~5:1).
- **Reduced motion:** add `@media (prefers-reduced-motion: reduce){ *{animation:none!important;transition:none!important} }`.
- **Semantic landmarks:** Layout has `<header>/<nav>/<main>` — add `<nav aria-label="Primary">` on BottomNav, `aria-current="page"` on active item, and a skip-to-content link.
- **ARIA:** icon-only buttons (FAB, back) need `aria-label`. Loading regions `aria-busy`. Toast `role="status"`/`aria-live="polite"`. Login button announces loading via `aria-disabled`.

---

## 5. Iconography

Replace all emoji (🗄️, 🔐, "←", "+ Add") with **`lucide-react`** — tree-shakable, consistent 1.5px stroke, themeable via `currentColor`, ~zero config with React. Map: Dashboard=`LayoutDashboard`, Documents=`FileText`, Family=`Users`, Settings=`Settings`, back=`ChevronLeft`, add=`Plus`, expiry=`AlertTriangle`/`Clock`, Google=keep brand SVG. Standardize icon size 20px in nav/list, 24px in AppBar/FAB. (Alternatively, hand-rolled inline SVG set if dependency-averse — but lucide is the pragmatic premium default.)

---

## 6. Prioritized implementation checklist

**P0 — foundations & mobile shell**
1. Expand `@theme` tokens (color ramp, surface, radius, shadow, motion) in `index.css`; antialiasing + reduced-motion media query.
2. Build `BottomNav` (icons+labels, safe-area, `min-h-14`); remove top tab strip; sticky `AppBar`; `<main>` `pb-24`.
3. Add `lucide-react`; replace all emoji.
4. Build core primitives: `Button`, `Card`, `Skeleton`, `EmptyState`, `ListItem`, `Badge`.
5. Enforce 44px tap targets + `focus-visible` rings globally; safe-area insets.
6. Set content width to `max-w-md`; add `overflow-x-hidden`, `overscroll-contain`, tap-highlight reset.

**P1 — page upgrades**
7. Documents: ListItem rows, expiry Badges, skeletons, EmptyState, FAB for Add.
8. Dashboard: skeleton stat cards, icons/accents, greeting, real EmptyState.
9. DocumentDetail: AppBar back, hero card, action buttons, skeleton/not-found.
10. Settings: grouped Cards, profile header, full-width sign-out Button.
11. Login: SVG logo, gradient backdrop, full-width button + spinner.
12. Upgrade `UpdateToast` to `Toast` primitive with `role=status` + safe-area.

**P2 — depth & delight**
13. Family member list + invite flow UI.
14. Tap-feedback (`active:scale`) + page transitions (reduced-motion aware).
15. Category filter chips + search on Documents; Avatar component.
16. Self-host Inter variable woff2; tabular-nums on stats.

---

## Implementation status (iteration 1 — applied & visually verified)

Done (P0 + most P1), verified with iPhone-viewport (390×844) screenshots of all 6 screens:

- ✅ Expanded `@theme` tokens (color ramp, surface/border, radius, shadow, motion), antialiasing,
  reduced-motion media query, safe-area helpers, premium radial backdrop, skeleton shimmer.
- ✅ Fixed **bottom navigation** (icons + labels, active state, safe-area) replacing the top tab strip;
  sticky **AppBar** per page (contextual title, back chevron, trailing actions).
- ✅ `lucide-react` icons throughout (emoji removed; branded Google "G" + shield logo on Login).
- ✅ UI primitives in `src/components/ui/`: `Button` (primary/secondary/ghost/danger/white, 44px,
  loading spinner, active:scale, focus-visible ring), `Card`, `Skeleton`, `EmptyState`, `ListItem`,
  `Badge` (expiry tones), `Avatar` (initials fallback), `AppBar`, `Fab`, `Page`, `Spinner`.
- ✅ 44px tap targets + `focus-visible` rings; `max-w-md` content; `overflow-x-hidden`,
  `overscroll-contain`, tap-highlight reset; iOS PWA meta tags + `apple-touch-icon`.
- ✅ Pages re-skinned: Login (logo + gradient + branded button), Dashboard (greeting + accented
  stat cards + empty state), Documents (ListItem rows + expiry badges + skeletons + EmptyState +
  FAB), DocumentDetail (back AppBar + hero card + action grid + metadata list), Family (invite +
  EmptyState), Settings (profile header + grouped Cards + danger sign-out).
- ✅ `UpdateToast` upgraded (`role=status`, icon, safe-area).
- ✅ Expiry-status helper (`src/lib/expiry.ts`) for green/amber/red badges.

Deferred to later iterations (need real data / later phases): loading-state on Login button is wired;
category filter chips + search, family member list rows, page transitions, self-hosted Inter,
and skeletons on Dashboard/Detail will land alongside Phase 1–3 data.
