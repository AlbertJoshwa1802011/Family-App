export type ThemeId =
  | "midnight"
  | "ocean"
  | "sunset"
  | "forest"
  | "royal"
  | "daylight";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  /** Two representative colours for the picker swatch (bg, accent). */
  swatch: [string, string];
  scheme: "dark" | "light";
}

export const THEMES: ThemeMeta[] = [
  { id: "midnight", label: "Midnight", swatch: ["#0b1220", "#14b8a6"], scheme: "dark" },
  { id: "ocean", label: "Ocean", swatch: ["#0a1120", "#3b82f6"], scheme: "dark" },
  { id: "sunset", label: "Sunset", swatch: ["#1a0f0b", "#f97316"], scheme: "dark" },
  { id: "forest", label: "Forest", swatch: ["#07160f", "#10b981"], scheme: "dark" },
  { id: "royal", label: "Royal", swatch: ["#110b1f", "#8b5cf6"], scheme: "dark" },
  { id: "daylight", label: "Daylight", swatch: ["#eef2f7", "#0d9488"], scheme: "light" },
];

export const THEME_STORAGE_KEY = "fv-theme";
export const DEFAULT_THEME: ThemeId = "midnight";

export function isThemeId(v: string | null): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}

/** Reads the persisted theme (used by both the provider and the no-flash script). */
export function readStoredTheme(): ThemeId {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(v)) return v;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall back to default.
  }
  return DEFAULT_THEME;
}
