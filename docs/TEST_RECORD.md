# Test record — Liquid Glass UI

Evidence for the liquid-glass redesign. Regenerate any part of this with the
commands shown; nothing here is transcribed by hand.

## Summary

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ (app + worker + node + **tests**) |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run test` | ✅ **774 passed / 774**, 36 files (after merging `main`) |
| `npm run build` | ✅ client + worker |
| Schema changes | none — no migration required |

Baseline before this work was **358 tests across 23 files**. The redesign adds
**266 tests across 5 new files**. After merging the multi-user scheduling work
that landed on the base branch, the combined suite is **774 across 36 files**.

## What was added

| File | Tests | Covers |
|---|---:|---|
| `tests/ui-primitives.test.tsx` | 87 | Card, Button, Badge, Avatar, Skeleton, Spinner, Page, Fab, EmptyState |
| `tests/ui-navigation.test.tsx` | 53 | ListItem, ListIcon, Sheet, BottomNav |
| `tests/ui-forms.test.tsx` | 50 | `inputCls`, Input/Textarea/Select/Label/Field, Chip, SegmentedControl |
| `tests/design-system.test.ts` | 50 | `src/index.css` cascade/stacking contracts + source hygiene |
| `tests/ui-regressions.test.tsx` | 24 | one test per defect found on a real phone viewport |

### Why the CSS contract tests exist

jsdom has no layout, no `@layer` ordering and no `backdrop-filter`. The two
worst bugs in this change were a **cascade** bug and a **stacking** bug, neither
of which any rendering test can catch. `tests/design-system.test.ts` therefore
parses `src/index.css` directly and asserts the invariants:

- the entire `.lq` ruleset lives inside `@layer components` (so Tailwind
  utilities still win — unlayered CSS beats every layered rule)
- no `.lq` rule leaks outside that layer
- every glass variable has a `:root` default (an undefined `--lq-tint` makes
  `color-mix()` invalid and silently drops the whole fill)
- modifiers only re-point variables; they never re-implement the recipe
- every `backdrop-filter` is paired with its `-webkit-` prefix (iOS Safari)
- `prefers-reduced-motion` neutralises duration *and* iteration count
- no element in `src/` carries both `.lq` and an unprefixed `bg-*` utility
- the pre-glass `border-line` / `focus:border-vault-500` recipes are fully retired

## Defects found and fixed

Each has a named regression test in `tests/ui-regressions.test.tsx`.

| Symptom | Root cause | Guard |
|---|---|---|
| Nav pill rendered as a huge misplaced blob | unlayered `.lq { position: relative }` beat Tailwind's `absolute` | pill keeps `absolute`; `.lq` is layered |
| Search magnifiers invisible | `backdrop-filter` stacking context painted the field over earlier absolute siblings | search overlays must carry a `z-*` class |
| Settings toggle knob hung outside its track | knob relied on an abs-child static position that resolved to 22px | knob pins an explicit `left-*`; travel arithmetic asserted |
| Document titles hard-clipped mid-word | `text-overflow: ellipsis` needs inline text, not an `inline-flex` wrapper | title text node carries its own `truncate` |
| Date-picker glyphs black-on-black | no `color-scheme` on the dark field | `inputCls` contains `[color-scheme:dark]` |
| Neutral badges brighter than row text | tinted white | neutral tints with `--color-fg-subtle` |

## Mutation check — do the guards actually catch their bugs?

A regression test that still passes once the bug is reintroduced is worse than
no test. Each guard was verified by reverting its fix and confirming the suite
goes red, then restoring:

| Reintroduced defect | Guard fires |
|---|---|
| un-layer the `.lq` recipe (the cascade bug) | ✅ |
| drop `z-1` from the search overlay (the stacking bug) | ✅ |
| remove `[color-scheme:dark]` from the field | ✅ |
| remove the toggle knob's explicit `left` | ✅ |
| put a `bg-*` utility on a glass element | ✅ |
| restore the pre-glass `border-line` field recipe | ✅ |
| delete the `--lq-tint` default | ✅ |
| drop `animation-iteration-count` from reduced-motion | ✅ |
| drop a `-webkit-backdrop-filter` prefix | ✅ |

The `bg-*` check failed this exercise on the first attempt: the scanner only
matched `className="..."`, so it saw nothing in files that build classes with
`cn(...)` and passed **vacuously**. It now brace-matches the whole `className=`
expression and unions every string literal inside, and a companion assertion
requires the scan to find 200+ class sets and 30+ glass elements so it can never
silently degrade to a no-op again.

## Manual / visual evidence

Both tools run against the real app on a 390×844 viewport with a seeded local
D1 — a real Worker runtime, not mocks.

```bash
npm run dev                 # terminal 1
npm run db:migrate:local && npm run dev:seed
npm run dev:screenshots     # still frames of every screen  -> screenshots/
npm run dev:record          # video walkthrough             -> recordings/
```

`dev:record` (added with this change) drives a scripted journey — scrolling the
dashboard, tapping all five nav tabs so the pill slides, opening and dismissing
the assistant sheet, toggling category and visibility chips, switching task
views — so *motion* can be reviewed, which still frames cannot show. Every step
is a real click through the UI, so a broken control fails the recording.

## Known gaps

- The older worker suites (`tests/*.test.ts`) are **not** in `tsconfig.test.json`.
  They predate it and need Cloudflare's ambient types plus some Anthropic SDK
  fixture updates to compile (18 pre-existing errors). Only the component tests
  and helpers are typechecked today; widening that is a separate cleanup.
- No automated contrast/axe pass yet. Tap targets, roles, labels and
  reduced-motion are asserted, but colour contrast is still reviewed by eye.
