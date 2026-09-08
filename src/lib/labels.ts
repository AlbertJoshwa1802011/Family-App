/**
 * Family type/category labels — frontend mirror of worker/lib/labels.ts.
 * Built-ins ship in code; customs come from GET /api/labels.
 */

export const LABEL_DOMAINS = [
  "event_type",
  "document_category",
  "expense_category",
  "note_kind",
  "contact_relationship",
] as const;

export type LabelDomain = (typeof LABEL_DOMAINS)[number];

export interface FamilyLabel {
  id: string | null;
  slug: string;
  label: string;
  emoji: string;
  sortOrder: number;
  builtin: boolean;
  custom: boolean;
}

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

/** Fallback builtins when the labels query hasn't loaded yet. */
export const BUILTIN_LABELS: Record<LabelDomain, FamilyLabel[]> = {
  event_type: [
    { id: null, slug: "gathering", label: "Gathering", emoji: "🎉", sortOrder: 0, builtin: true, custom: false },
    { id: null, slug: "appointment", label: "Appointment", emoji: "📅", sortOrder: 1, builtin: true, custom: false },
    { id: null, slug: "milestone", label: "Milestone", emoji: "⭐", sortOrder: 2, builtin: true, custom: false },
    { id: null, slug: "other", label: "Other", emoji: "📌", sortOrder: 3, builtin: true, custom: false },
  ],
  document_category: [
    { id: null, slug: "identity", label: "Identity", emoji: "🪪", sortOrder: 0, builtin: true, custom: false },
    { id: null, slug: "insurance", label: "Insurance", emoji: "🛡️", sortOrder: 1, builtin: true, custom: false },
    { id: null, slug: "medical", label: "Medical", emoji: "🩺", sortOrder: 2, builtin: true, custom: false },
    { id: null, slug: "vehicle", label: "Vehicle", emoji: "🚗", sortOrder: 3, builtin: true, custom: false },
    { id: null, slug: "finance", label: "Finance", emoji: "💳", sortOrder: 4, builtin: true, custom: false },
    { id: null, slug: "warranty", label: "Warranty", emoji: "🧾", sortOrder: 5, builtin: true, custom: false },
    { id: null, slug: "education", label: "Education", emoji: "🎓", sortOrder: 6, builtin: true, custom: false },
    { id: null, slug: "other", label: "Other", emoji: "📄", sortOrder: 7, builtin: true, custom: false },
  ],
  expense_category: [
    { id: null, slug: "food", label: "Food", emoji: "🍽️", sortOrder: 0, builtin: true, custom: false },
    { id: null, slug: "groceries", label: "Groceries", emoji: "🛒", sortOrder: 1, builtin: true, custom: false },
    { id: null, slug: "transport", label: "Transport", emoji: "🚌", sortOrder: 2, builtin: true, custom: false },
    { id: null, slug: "household", label: "Household", emoji: "🏠", sortOrder: 3, builtin: true, custom: false },
    { id: null, slug: "medical", label: "Medical", emoji: "💊", sortOrder: 4, builtin: true, custom: false },
    { id: null, slug: "education", label: "Education", emoji: "📚", sortOrder: 5, builtin: true, custom: false },
    { id: null, slug: "entertainment", label: "Entertainment", emoji: "🎬", sortOrder: 6, builtin: true, custom: false },
    { id: null, slug: "travel", label: "Travel", emoji: "✈️", sortOrder: 7, builtin: true, custom: false },
    { id: null, slug: "other", label: "Other", emoji: "💸", sortOrder: 8, builtin: true, custom: false },
  ],
  note_kind: [
    { id: null, slug: "general", label: "General", emoji: "📝", sortOrder: 0, builtin: true, custom: false },
    { id: null, slug: "bible", label: "Bible", emoji: "📖", sortOrder: 1, builtin: true, custom: false },
    { id: null, slug: "journal", label: "Journal", emoji: "📔", sortOrder: 2, builtin: true, custom: false },
    { id: null, slug: "other", label: "Other", emoji: "✏️", sortOrder: 3, builtin: true, custom: false },
  ],
  contact_relationship: [
    { id: null, slug: "doctor", label: "Doctor", emoji: "🩺", sortOrder: 0, builtin: true, custom: false },
    { id: null, slug: "school", label: "School", emoji: "🏫", sortOrder: 1, builtin: true, custom: false },
    { id: null, slug: "plumber", label: "Plumber", emoji: "🔧", sortOrder: 2, builtin: true, custom: false },
    { id: null, slug: "family", label: "Family", emoji: "👨‍👩‍👧", sortOrder: 3, builtin: true, custom: false },
    { id: null, slug: "emergency", label: "Emergency", emoji: "🚨", sortOrder: 4, builtin: true, custom: false },
    { id: null, slug: "other", label: "Other", emoji: "👤", sortOrder: 5, builtin: true, custom: false },
  ],
};

export function findLabel(
  labels: FamilyLabel[],
  value: string | null | undefined,
): FamilyLabel | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return labels.find(
    (l) => l.slug.toLowerCase() === v || l.label.toLowerCase() === v,
  );
}

/** Chip / badge text: "🎉 Gathering" */
export function formatLabelText(
  labels: FamilyLabel[],
  value: string | null | undefined,
  fallbackEmoji = "📌",
): string {
  if (!value) return "";
  const hit = findLabel(labels, value);
  if (hit) return `${hit.emoji} ${hit.label}`;
  return `${fallbackEmoji} ${value}`;
}
