import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  THEMES,
  THEME_STORAGE_KEY,
  readStoredTheme,
  type ThemeId,
  type ThemeMeta,
} from "../lib/themes";

interface ThemeValue {
  theme: ThemeId;
  setTheme: (id: ThemeId) => void;
  themes: ThemeMeta[];
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    // Keep the iOS status-bar / address-bar colour in sync with the surface.
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(root).getPropertyValue("--color-ink-950").trim();
      if (bg) meta.content = bg;
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // best-effort persistence
    }
  }, [theme]);

  const value: ThemeValue = { theme, setTheme: setThemeState, themes: THEMES };
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
