/**
 * Production Contacts sync selects google_resource_name / google_etag /
 * last_pushed_at. Those columns land via migration 0013. If a D1 restore or a
 * partial apply left them off, sync throws a raw Drizzle "Failed query".
 * Ensure them before reading so a family can sync without a laptop migrate.
 */
export async function ensureContactsGoogleColumns(db: D1Database): Promise<void> {
  const info = await db.prepare("PRAGMA table_info(contacts)").all<{ name: string }>();
  const names = new Set((info.results ?? []).map((r) => r.name));

  if (!names.has("google_resource_name")) {
    await db.prepare("ALTER TABLE contacts ADD COLUMN google_resource_name text").run();
  }
  if (!names.has("google_etag")) {
    await db.prepare("ALTER TABLE contacts ADD COLUMN google_etag text").run();
  }
  if (!names.has("last_pushed_at")) {
    await db.prepare("ALTER TABLE contacts ADD COLUMN last_pushed_at integer").run();
  }

  const idx = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_contact_google_resource'",
    )
    .first<{ name: string }>();
  if (!idx) {
    // Partial unique: many local rows share NULL google_resource_name.
    await db
      .prepare(
        "CREATE UNIQUE INDEX uq_contact_google_resource ON contacts (family_id, google_resource_name) WHERE google_resource_name IS NOT NULL",
      )
      .run();
  }
}

export function contactDbErrorMessage(err: unknown): { message: string; detail: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const cause =
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  const blob = [raw, cause].filter(Boolean).join("\n");

  if (/no such column/i.test(blob)) {
    return {
      message:
        "Contacts storage was missing Google sync columns. They are being added — tap Sync again.",
      detail: blob,
    };
  }
  if (/unique constraint/i.test(blob)) {
    return {
      message: "That Google contact is already in the family list. Tap Sync again.",
      detail: blob,
    };
  }
  if (blob.includes("Failed query:")) {
    return {
      message: "Could not save Google contacts to the family database. Tap Sync again.",
      detail: blob,
    };
  }
  return { message: raw, detail: blob };
}
