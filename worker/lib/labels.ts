/**
 * Family labels — built-in type/category catalogs + helpers for custom ones.
 *
 * Entities store a short `slug` (events.type, documents.category, …).
 * Display label + emoji come from built-ins merged with `family_labels` rows.
 */
import { z } from "zod";
import {
  LABEL_DOMAINS,
  type LabelDomain,
} from "../db/schema";

export { LABEL_DOMAINS, type LabelDomain };

export interface LabelDef {
  slug: string;
  label: string;
  emoji: string;
}

/** Slug stored on entities — short, URL-safe, stable. */
export const labelSlugSchema = z
  .string()
  .min(1)
  .max(50)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/i,
    "Must start with a letter or number; only letters, numbers, _ and -",
  );

/** Display name for a chip / badge. */
export const labelNameSchema = z.string().trim().min(1).max(40);

/**
 * Emoji adornment. Keep short — one grapheme cluster is typical; allow a few
 * code points for ZWJ sequences (e.g. 👨‍👩‍👧).
 */
export const labelEmojiSchema = z.string().trim().min(1).max(16);

export const BUILTIN_LABELS: Record<LabelDomain, readonly LabelDef[]> = {
  event_type: [
    { slug: "gathering", label: "Gathering", emoji: "🎉" },
    { slug: "appointment", label: "Appointment", emoji: "📅" },
    { slug: "milestone", label: "Milestone", emoji: "⭐" },
    { slug: "other", label: "Other", emoji: "📌" },
  ],
  document_category: [
    { slug: "identity", label: "Identity", emoji: "🪪" },
    { slug: "insurance", label: "Insurance", emoji: "🛡️" },
    { slug: "medical", label: "Medical", emoji: "🩺" },
    { slug: "vehicle", label: "Vehicle", emoji: "🚗" },
    { slug: "finance", label: "Finance", emoji: "💳" },
    { slug: "warranty", label: "Warranty", emoji: "🧾" },
    { slug: "education", label: "Education", emoji: "🎓" },
    { slug: "other", label: "Other", emoji: "📄" },
  ],
  expense_category: [
    { slug: "food", label: "Food", emoji: "🍽️" },
    { slug: "groceries", label: "Groceries", emoji: "🛒" },
    { slug: "transport", label: "Transport", emoji: "🚌" },
    { slug: "household", label: "Household", emoji: "🏠" },
    { slug: "medical", label: "Medical", emoji: "💊" },
    { slug: "education", label: "Education", emoji: "📚" },
    { slug: "entertainment", label: "Entertainment", emoji: "🎬" },
    { slug: "travel", label: "Travel", emoji: "✈️" },
    { slug: "other", label: "Other", emoji: "💸" },
  ],
  note_kind: [
    { slug: "general", label: "General", emoji: "📝" },
    { slug: "bible", label: "Bible", emoji: "📖" },
    { slug: "journal", label: "Journal", emoji: "📔" },
    { slug: "other", label: "Other", emoji: "✏️" },
  ],
  contact_relationship: [
    { slug: "doctor", label: "Doctor", emoji: "🩺" },
    { slug: "school", label: "School", emoji: "🏫" },
    { slug: "plumber", label: "Plumber", emoji: "🔧" },
    { slug: "family", label: "Family", emoji: "👨‍👩‍👧" },
    { slug: "emergency", label: "Emergency", emoji: "🚨" },
    { slug: "other", label: "Other", emoji: "👤" },
  ],
};

/** Curated picker set for "create new type" sheets. */
export const EMOJI_PICKER = [
  "🎉",
  "📅",
  "⭐",
  "📌",
  "🪪",
  "🛡️",
  "🩺",
  "🚗",
  "💳",
  "🧾",
  "🎓",
  "📄",
  "🍽️",
  "🛒",
  "🚌",
  "🏠",
  "💊",
  "📚",
  "🎬",
  "✈️",
  "💸",
  "📝",
  "📖",
  "📔",
  "✏️",
  "🏫",
  "🔧",
  "👨‍👩‍👧",
  "🚨",
  "👤",
  "⛪",
  "🙏",
  "🎂",
  "🏥",
  "💼",
  "⚽",
  "🎵",
  "🐾",
  "🌱",
  "💡",
  "🔑",
  "📞",
  "❤️",
  "🌈",
] as const;

/** Turn a display name into a stable slug (`Family Reunion` → `family_reunion`). */
export function slugifyLabel(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return base || "custom";
}

export function isLabelDomain(value: string): value is LabelDomain {
  return (LABEL_DOMAINS as readonly string[]).includes(value);
}

export interface MergedLabel {
  id: string | null; // null = built-in only (not persisted)
  slug: string;
  label: string;
  emoji: string;
  sortOrder: number;
  builtin: boolean;
  custom: boolean;
}

/**
 * Merge built-in defaults with family rows. Custom rows with the same slug
 * override label/emoji (and keep the row id for edit/delete). Extra custom
 * slugs append after built-ins, ordered by sortOrder then label.
 */
export function mergeLabels(
  domain: LabelDomain,
  custom: Array<{
    id: string;
    slug: string;
    label: string;
    emoji: string | null;
    sortOrder: number;
  }>,
): MergedLabel[] {
  const builtins = BUILTIN_LABELS[domain];
  const bySlug = new Map(custom.map((c) => [c.slug.toLowerCase(), c]));

  const merged: MergedLabel[] = builtins.map((b, i) => {
    const override = bySlug.get(b.slug.toLowerCase());
    if (override) {
      bySlug.delete(b.slug.toLowerCase());
      return {
        id: override.id,
        slug: b.slug,
        label: override.label || b.label,
        emoji: override.emoji || b.emoji,
        sortOrder: override.sortOrder,
        builtin: true,
        custom: true,
      };
    }
    return {
      id: null,
      slug: b.slug,
      label: b.label,
      emoji: b.emoji,
      sortOrder: i,
      builtin: true,
      custom: false,
    };
  });

  const extras = [...bySlug.values()]
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.label.localeCompare(b.label) ||
        a.slug.localeCompare(b.slug),
    )
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      label: c.label,
      emoji: c.emoji || "📌",
      sortOrder: c.sortOrder,
      builtin: false,
      custom: true,
    }));

  return [...merged, ...extras];
}

/** Look up display bits for a stored slug (falls back to the slug itself). */
export function resolveLabel(
  domain: LabelDomain,
  slug: string,
  custom: MergedLabel[] = mergeLabels(domain, []),
): { slug: string; label: string; emoji: string } {
  const hit = custom.find((l) => l.slug.toLowerCase() === slug.toLowerCase());
  if (hit) return { slug: hit.slug, label: hit.label, emoji: hit.emoji };
  const builtin = BUILTIN_LABELS[domain].find(
    (b) => b.slug.toLowerCase() === slug.toLowerCase(),
  );
  if (builtin) return builtin;
  return { slug, label: slug, emoji: "📌" };
}
