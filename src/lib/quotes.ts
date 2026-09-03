/**
 * One family quote per calendar day. Stable for a given local date so everyone
 * in the house sees the same line. No network — this is the native-app seed
 * that a future iOS widget can import as-is.
 */
export interface DailyQuote {
  text: string;
  attribution: string;
}

const QUOTES: DailyQuote[] = [
  {
    text: "The home is the first church, the first school, and the first hospital.",
    attribution: "Irish proverb",
  },
  {
    text: "What you keep with care, you do not have to remember in panic.",
    attribution: "Family Vault",
  },
  {
    text: "The love of a family is life's greatest blessing.",
    attribution: "Anonymous",
  },
  {
    text: "To us, family means putting your arms around each other and being there.",
    attribution: "Barbara Bush",
  },
  {
    text: "The strength of a family, like the strength of an army, is in its loyalty to each other.",
    attribution: "Mario Puzo",
  },
  {
    text: "Call it a clan, call it a network, call it a tribe, call it a family. Whatever you call it, whoever you are, you need one.",
    attribution: "Jane Howard",
  },
  {
    text: "A happy family is but an earlier heaven.",
    attribution: "George Bernard Shaw",
  },
  {
    text: "The family is one of nature's masterpieces.",
    attribution: "George Santayana",
  },
  {
    text: "In family life, love is the oil that eases friction, the cement that binds closer together, and the music that brings harmony.",
    attribution: "Friedrich Nietzsche",
  },
  {
    text: "Other things may change us, but we start and end with the family.",
    attribution: "Anthony Brandt",
  },
  {
    text: "The informality of family life is a blessed condition that allows us to become our best while looking our worst.",
    attribution: "Marge Kennedy",
  },
  {
    text: "Family is not an important thing. It's everything.",
    attribution: "Michael J. Fox",
  },
  {
    text: "The memories we make with our family are everything.",
    attribution: "Candace Cameron Bure",
  },
  {
    text: "Home is where you are loved the most and act the worst.",
    attribution: "Marjorie Pay Hinckley",
  },
  {
    text: "The most important thing in the world is family and love.",
    attribution: "John Wooden",
  },
  {
    text: "Families are the compass that guides us. They are the inspiration to reach great heights, and our comfort when we occasionally falter.",
    attribution: "Brad Henry",
  },
  {
    text: "Rejoice with your family in the beautiful land of life.",
    attribution: "Albert Einstein",
  },
  {
    text: "A man travels the world over in search of what he needs, and returns home to find it.",
    attribution: "George Moore",
  },
  {
    text: "The bond that links your true family is not one of blood, but of respect and joy in each other's life.",
    attribution: "Richard Bach",
  },
  {
    text: "What can you do to promote world peace? Go home and love your family.",
    attribution: "Mother Teresa",
  },
  {
    text: "The family — that dear octopus from whose tentacles we never quite escape, nor, in our inmost hearts, ever quite wish to.",
    attribution: "Dodie Smith",
  },
  {
    text: "Keep the things that matter where the people who matter can find them.",
    attribution: "Family Vault",
  },
  {
    text: "There is no doubt that it is around the family and the home that all the greatest virtues, the most dominating virtues of human society, are created, strengthened and maintained.",
    attribution: "Winston Churchill",
  },
  {
    text: "You don't choose your family. They are God's gift to you, as you are to them.",
    attribution: "Desmond Tutu",
  },
  {
    text: "The family is the test of freedom; because the family is the only thing that the free man makes for himself and by himself.",
    attribution: "G. K. Chesterton",
  },
  {
    text: "Having somewhere to go is home. Having someone to love is family. Having both is a blessing.",
    attribution: "Anonymous",
  },
  {
    text: "We may not have it all together, but together we have it all.",
    attribution: "Anonymous",
  },
  {
    text: "The light is on in the kitchen. That is enough of a map.",
    attribution: "Family Vault",
  },
];

/** Day-of-year in local time (0–365). */
export function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

export function quoteForDate(date: Date): DailyQuote {
  const i = dayOfYear(date) % QUOTES.length;
  return QUOTES[i]!;
}

export function allQuotes(): readonly DailyQuote[] {
  return QUOTES;
}
