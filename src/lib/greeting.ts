/**
 * Time-of-day greeting copy. Pure so the dashboard and a future native Home
 * screen can share the same phrases. Pass local hours (0–23).
 */
export interface Greeting {
  /** Short salutation, e.g. "Good morning". */
  phrase: string;
  /** One-line warmth under the name — not a product pitch. */
  wish: string;
}

export function greetingForHour(hour: number): Greeting {
  if (hour >= 5 && hour < 12) {
    return {
      phrase: "Good morning",
      wish: "A quiet start. The important things are already here.",
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      phrase: "Good afternoon",
      wish: "Midday is for the living — check what needs you.",
    };
  }
  if (hour >= 17 && hour < 21) {
    return {
      phrase: "Good evening",
      wish: "The day is folding. Leave the family a little lighter.",
    };
  }
  return {
    phrase: "Good night",
    wish: "Rest. Reminders will keep watch until morning.",
  };
}

/** Locale date line for the Home header, e.g. "Wednesday, 2 September". */
export function formatHomeDate(date: Date, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}
