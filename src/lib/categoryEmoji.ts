/**
 * Money Manager–style emoji for expense categories (SPA copy of the worker map).
 */

const BY_ID: Record<string, string> = {
  builtin_groceries: "🛒",
  builtin_groceries_supermarket: "🏪",
  builtin_groceries_vegetables: "🥬",
  builtin_dining: "🍔",
  builtin_dining_coffee: "☕",
  builtin_dining_restaurants: "🍜",
  builtin_transport: "🚌",
  builtin_fuel: "⛽",
  builtin_transport_rideshare: "🚕",
  builtin_housing: "🏠",
  builtin_utilities: "💡",
  builtin_internet: "📱",
  builtin_healthcare: "💊",
  builtin_education: "📚",
  builtin_insurance: "🛡️",
  builtin_subscriptions: "📺",
  builtin_shopping: "🛍️",
  builtin_shopping_online: "🌐",
  builtin_shopping_offline: "🏬",
  builtin_entertainment: "🎬",
  builtin_travel: "✈️",
  builtin_personal_care: "✨",
  builtin_gifts: "🎁",
  builtin_tithe: "🙏",
  builtin_children: "👨‍👩‍👧",
  builtin_investments: "📈",
  builtin_emi: "🏦",
  builtin_fees: "🧾",
  builtin_other: "📦",
};

const BY_LUCIDE: Record<string, string> = {
  ShoppingCart: "🛒",
  Store: "🏪",
  Leaf: "🥬",
  Utensils: "🍔",
  Coffee: "☕",
  UtensilsCrossed: "🍜",
  Bus: "🚌",
  Fuel: "⛽",
  Car: "🚕",
  Home: "🏠",
  Zap: "💡",
  Wifi: "📱",
  HeartPulse: "💊",
  GraduationCap: "📚",
  Shield: "🛡️",
  Repeat: "📺",
  ShoppingBag: "🛍️",
  Globe: "🌐",
  Clapperboard: "🎬",
  Plane: "✈️",
  Sparkles: "✨",
  Gift: "🎁",
  HeartHandshake: "🙏",
  Users: "👨‍👩‍👧",
  TrendingUp: "📈",
  Landmark: "🏦",
  Receipt: "🧾",
  CircleDot: "📦",
};

function looksLikeLucideName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]+$/.test(value);
}

export function resolveCategoryEmoji(input: {
  id?: string | null;
  icon?: string | null;
}): string {
  if (input.id && BY_ID[input.id]) return BY_ID[input.id]!;
  const icon = input.icon?.trim();
  if (!icon) return "📦";
  if (!looksLikeLucideName(icon)) return icon;
  return BY_LUCIDE[icon] ?? "📦";
}

export const QUICK_CATEGORY_EMOJIS = [
  "🍔",
  "🛒",
  "🚗",
  "🏠",
  "💊",
  "📚",
  "🎬",
  "✈️",
  "🛍️",
  "📦",
  "☕",
  "⛽",
  "🚕",
  "💡",
  "🎁",
  "📱",
  "🎮",
  "🍜",
  "🧾",
  "🔖",
] as const;
