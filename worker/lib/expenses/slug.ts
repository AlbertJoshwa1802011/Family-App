/**
 * Slugs for user-created categories and payment methods.
 *
 * A slug is a STABLE IDENTITY KEY, not a display value: it is generated once at
 * creation and never changes when the row is renamed. Seeding, "reset to
 * defaults" and (later) import mappings key on it, so a slug that drifted every
 * time someone fixed a typo would silently break them.
 */

const MAX_SLUG_LENGTH = 60;

/** "Kids' Activities!" → "kids-activities" */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    // Drop combining marks so "Café" slugs as "cafe".
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  // Names made entirely of emoji or non-Latin script leave nothing behind;
  // the caller uniquifies, so "item-2", "item-3" … stay stable and readable.
  return slug === "" ? "item" : slug;
}

/**
 * First free slug of the form `base`, `base-2`, `base-3`, … given the slugs
 * already taken in this family. The per-family unique index is the real
 * guarantee; this keeps the common path from ever hitting it.
 */
export function ensureUniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, MAX_SLUG_LENGTH - 5)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Pathological: 1000 same-named siblings. Fall back to something unique.
  return `${base.slice(0, MAX_SLUG_LENGTH - 9)}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Subcategory slugs are parent-prefixed ("food-groceries"), matching the seeded
 * tree, so one flat per-family namespace stays readable and collision-free —
 * "streaming" legitimately exists under both Entertainment and Subscriptions.
 */
export function childSlugBase(parentSlug: string, childName: string): string {
  return slugify(`${parentSlug}-${slugify(childName)}`);
}
