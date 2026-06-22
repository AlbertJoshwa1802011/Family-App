# Redesign Plan — Premium Case-Management PWA

> Status: **shipped** (slices 1–5 + occasions + chat). This document is the
> execution plan for the redesign + feature expansion. Definition of done per
> slice: `typecheck`, `lint`, `test`, `build` all green (and `db:generate` +
> `validate_migrations.py` when the schema changes). Suite: 211 tests, 15 files.
>
> Delivered: theme engine (6 themes) · iOS polish · fixed upload (drag-drop +
> progress) · real DocumentDetail · categories + smart ordering · server search +
> keyword/OCR index · occasions (birthday/anniversary/custom) with member tagging ·
> occasion reminders in cron · WhatsApp-style family chat · customizable email
> report templates · CSRF + rate limiting + fuller audit log.

## Goals (from the product owner)

1. Make manual "family cases" (renewals, claims, appointments, admissions) easy.
2. Replace the boring UI with a **premium, iOS-grade** experience.
3. **Theme switching** so families can pick their look.
4. **Fix file upload** and make it smooth (drag-drop + progress).
5. **Fastest retrieval** — intelligent ordering + a real search experience.
6. **Background extraction** of keywords from uploads so search surfaces files.
7. **Customizable email report** templates.
8. **Security** for increasingly sensitive data.

## Slices (each is a green commit)

### Slice 1 — Theme engine + premium polish
- Convert `src/index.css` to a CSS-variable theme system. The `@theme` block keeps
  the default (Midnight) values so Tailwind still generates utilities; per-theme
  overrides live in `[data-theme="…"]` blocks. Tailwind v4 utilities compile to
  `var(--color-…)`, so overriding the variables re-themes the whole app with **no
  component changes**.
- Themes: `midnight` (default), `ocean`, `sunset`, `forest`, `royal`, `daylight` (light).
- `src/context/ThemeContext.tsx` + `useTheme`; persisted to `localStorage`; applied
  to `<html data-theme>`. No-flash inline script in `index.html`.
- Theme picker UI in Settings (swatches).

### Slice 2 — Fix document upload + DocumentDetail + list
- `src/lib/upload.ts`: XHR-based resumable Drive upload helper with progress.
- `src/pages/DocumentForm.tsx`: create/edit form + drag-drop file picker + progress.
  3-step flow: create metadata → get resumable URL → PUT to Drive → record file.
- `src/pages/Documents.tsx`: pass `familyId`, search bar, category grouping, wire FAB.
- `src/pages/DocumentDetail.tsx`: real fetch — metadata, files/versions, download,
  edit, delete, comments.
- Routes: `/documents/new`, `/documents/:id/edit`.

### Slice 3 — Search, categories, tags, extraction index
- Schema: `document_extracts` (extracted text/keywords/status) + `keywords` search
  helper. Predefined category list (frontend) with icons.
- `GET /api/documents/search?familyId&q&category&tag` — LIKE over title/description/
  category + extract keywords + tag match; smart ordering (expiring first).
- Tag endpoints + UI chips.
- Extraction job scaffold in cron (gated on OCR provider key; no-op without it).

### Slice 4 — Security hardening
- `worker/middleware/requireValidOrigin.ts` — Origin/Referer check; enforced only
  when a session cookie is present (so unauthenticated tests still see 401). Applied
  to all mutations + the download proxy.
- `worker/middleware/rateLimit.ts` — KV fixed-window limiter; skips when KV absent
  (tests) ; tight limits on auth, looser on mutations.
- Audit writes added to PATCH document, comments, events/tasks/contacts.

### Slice 5 — Customizable email report templates
- Schema: `email_templates` (per family, type, html, active).
- `worker/lib/email.ts`: `renderTemplate(html, vars)` `{{var}}` engine (escaped).
- Template CRUD endpoints; Settings editor + live preview; cron resolves the active
  template, falling back to the built-in default.

## Notes / decisions
- Tests run with no D1/KV binding (`app.request`), so new routes are covered at the
  contract level (401/404/headers/validation) + pure-function units, matching the
  existing suite.
- Background OCR extraction needs an external provider key; the pipeline and storage
  are real and tested, but extraction is a no-op until a key is configured.
</content>
</invoke>
