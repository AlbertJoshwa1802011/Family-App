import { describe, expect, it } from "vitest";
import { formatHomeDate, greetingForHour } from "../src/lib/greeting";
import { allQuotes, dayOfYear, quoteForDate } from "../src/lib/quotes";

describe("greetingForHour", () => {
  it("morning, afternoon, evening, night", () => {
    expect(greetingForHour(5).phrase).toBe("Good morning");
    expect(greetingForHour(11).phrase).toBe("Good morning");
    expect(greetingForHour(12).phrase).toBe("Good afternoon");
    expect(greetingForHour(16).phrase).toBe("Good afternoon");
    expect(greetingForHour(17).phrase).toBe("Good evening");
    expect(greetingForHour(20).phrase).toBe("Good evening");
    expect(greetingForHour(21).phrase).toBe("Good night");
    expect(greetingForHour(4).phrase).toBe("Good night");
  });

  it("wishes are non-empty", () => {
    for (const h of [7, 13, 19, 23]) {
      expect(greetingForHour(h).wish.length).toBeGreaterThan(10);
    }
  });
});

describe("formatHomeDate", () => {
  it("formats a stable UTC morning as a long weekday date in en-GB", () => {
    const d = new Date(Date.UTC(2026, 8, 2, 8, 0, 0));
    const label = formatHomeDate(d, "en-GB");
    expect(label).toMatch(/September/);
    expect(label).toMatch(/2/);
  });
});

describe("quoteForDate", () => {
  it("returns the same quote for the same local calendar day", () => {
    const a = new Date(2026, 8, 2, 8, 0, 0);
    const b = new Date(2026, 8, 2, 21, 0, 0);
    expect(quoteForDate(a)).toEqual(quoteForDate(b));
  });

  it("rotates across days", () => {
    const a = quoteForDate(new Date(2026, 0, 1));
    const b = quoteForDate(new Date(2026, 0, 2));
    expect(a.text).not.toBe(b.text);
  });

  it("every quote has text and attribution", () => {
    for (const q of allQuotes()) {
      expect(q.text.length).toBeGreaterThan(20);
      expect(q.attribution.length).toBeGreaterThan(2);
    }
  });

  it("dayOfYear is 1-based for Jan 1", () => {
    expect(dayOfYear(new Date(2026, 0, 1, 12))).toBe(1);
  });
});
