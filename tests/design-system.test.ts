/**
 * Contract tests for the liquid-glass design system.
 *
 * These parse `src/index.css` and the component sources rather than rendering,
 * because the bugs they guard against are *cascade* and *stacking* bugs that no
 * amount of jsdom rendering can catch (jsdom has no layout, no @layer ordering
 * and no backdrop-filter). Every assertion here corresponds to a real defect
 * found while reviewing the running app — see CLAUDE.md "Liquid Glass design
 * system" for the narrative.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("src/index.css", "utf8");

/** All .tsx sources under src/, recursively. */
function sourceFiles(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}

/** The body of the `@layer components { ... }` block, brace-matched. */
function componentsLayer(): string {
  const start = css.indexOf("@layer components {");
  if (start === -1) throw new Error("no @layer components block in src/index.css");
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced braces in @layer components");
}

/** The declarations of a single rule, e.g. ruleBody(".lq-chrome"). */
function ruleBody(selector: string, from = css): string {
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*\\{`, "m");
  const m = re.exec(from);
  if (!m) throw new Error(`rule "${selector}" not found`);
  const open = from.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < from.length; i++) {
    if (from[i] === "{") depth++;
    else if (from[i] === "}") {
      depth--;
      if (depth === 0) return from.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces in "${selector}"`);
}

const LAYER = componentsLayer();

describe("cascade: the glass recipe must lose to Tailwind utilities", () => {
  it("wraps the whole .lq ruleset in @layer components", () => {
    // Unlayered CSS beats every layered rule regardless of specificity. When
    // .lq was unlayered it silently overrode `absolute` on the nav's sliding
    // pill and `bg-*` on glass elements.
    expect(LAYER).toContain(".lq {");
  });

  it("declares every .lq modifier inside that layer", () => {
    for (const mod of [
      ".lq-chrome",
      ".lq-raised",
      ".lq-flat",
      ".lq-tint",
      ".lq-primary",
      ".lq-danger",
      ".lq-white",
      ".lq-field",
      ".lq-press",
    ]) {
      expect(LAYER).toContain(`${mod} {`);
    }
  });

  it("leaves no .lq rule outside the layer", () => {
    const outside = css.replace(LAYER, "");
    expect(/(^|\})\s*\.lq[\s.:{,]/m.test(outside)).toBe(false);
  });

  it("does not set `position` on any modifier — only .lq owns positioning", () => {
    for (const mod of [".lq-chrome", ".lq-raised", ".lq-flat", ".lq-primary"]) {
      expect(ruleBody(mod, LAYER)).not.toMatch(/(^|;)\s*position\s*:/);
    }
  });
});

describe(":root supplies a default for every glass variable", () => {
  const rootBlock = css.slice(0, css.indexOf("@layer components"));

  it.each([
    "--lq-fill",
    "--lq-rim",
    "--lq-sheen",
    "--lq-shadow",
    "--lq-blur",
    "--lq-bg",
    "--lq-tint",
  ])("defines %s", (name) => {
    expect(rootBlock).toContain(`${name}:`);
  });

  it("defaults --lq-tint so .lq-tint never resolves to an invalid colour", () => {
    // color-mix() with an undefined var makes background-image invalid at
    // computed-value time, which silently drops the fill entirely.
    expect(/--lq-tint:\s*#?\w/.test(rootBlock)).toBe(true);
  });
});

describe(".lq base recipe", () => {
  const lq = ruleBody(".lq", LAYER);

  it("drives its background from variables, not hard-coded colours", () => {
    expect(lq).toContain("background-color: var(--lq-bg)");
    expect(lq).toContain("background-image: var(--lq-fill)");
  });

  it("drives its shadow and blur from variables", () => {
    expect(lq).toContain("var(--lq-shadow)");
    expect(lq).toContain("var(--lq-blur)");
  });

  it("isolates so the sheen's negative z-index cannot escape the bubble", () => {
    expect(lq).toContain("isolation: isolate");
  });

  it("is position: relative so the rim and sheen have a containing block", () => {
    expect(lq).toMatch(/position:\s*relative/);
  });

  it("puts the specular rim on ::before", () => {
    expect(ruleBody("\\.lq::before", LAYER)).toContain("var(--lq-rim)");
  });

  it("puts the inner sheen on ::after", () => {
    expect(ruleBody("\\.lq::after", LAYER)).toContain("var(--lq-sheen)");
  });

  it("paints the sheen behind content with a negative z-index", () => {
    // Positive would cover the card's own text.
    expect(ruleBody("\\.lq::after", LAYER)).toMatch(/z-index:\s*-1/);
  });

  it("inherits the border radius on both pseudo-elements", () => {
    for (const sel of ["\\.lq::before", "\\.lq::after"]) {
      expect(ruleBody(sel, LAYER)).toContain("border-radius: inherit");
    }
  });

  it("makes both pseudo-elements click-through", () => {
    for (const sel of ["\\.lq::before", "\\.lq::after"]) {
      expect(ruleBody(sel, LAYER)).toContain("pointer-events: none");
    }
  });

  it("masks the rim with both the prefixed and standard properties", () => {
    const before = ruleBody("\\.lq::before", LAYER);
    expect(before).toContain("-webkit-mask:");
    expect(before).toContain("mask:");
    expect(before).toContain("-webkit-mask-composite:");
    expect(before).toContain("mask-composite:");
  });
});

describe("vendor prefixes", () => {
  it("pairs every backdrop-filter with its -webkit- prefix (iOS Safari)", () => {
    const std = (css.match(/(^|[^-])backdrop-filter:/g) ?? []).length;
    const pre = (css.match(/-webkit-backdrop-filter:/g) ?? []).length;
    expect(pre).toBe(std);
  });
});

describe("glass modifiers only re-point variables", () => {
  const VARIABLE_ONLY = [".lq-chrome", ".lq-raised", ".lq-primary", ".lq-danger", ".lq-white"];

  it.each(VARIABLE_ONLY)("%s declares only custom properties (and colour)", (mod) => {
    const decls = ruleBody(mod, LAYER)
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      // gradients contain commas/parens but each declaration still starts with its property
      .map((d) => d.slice(0, d.indexOf(":")).trim())
      .filter((p) => p && !p.startsWith("("));
    for (const prop of decls) {
      expect(prop.startsWith("--") || prop === "color").toBe(true);
    }
  });

  it(".lq-flat turns off backdrop blur for dense scrolling lists", () => {
    const flat = ruleBody(".lq-flat", LAYER);
    expect(flat).toContain("backdrop-filter: none");
    expect(flat).toContain("-webkit-backdrop-filter: none");
  });

  it(".lq-chrome is opaque enough to hide content scrolling under it", () => {
    const bg = /--lq-bg:\s*#([0-9a-f]{8})/i.exec(ruleBody(".lq-chrome", LAYER));
    expect(bg).not.toBeNull();
    const alpha = parseInt(bg![1].slice(6), 16) / 255;
    expect(alpha).toBeGreaterThan(0.8);
  });

  it(".lq-chrome blurs harder than the default surface", () => {
    const chrome = Number(/--lq-blur:\s*(\d+)px/.exec(ruleBody(".lq-chrome", LAYER))![1]);
    const base = Number(
      /--lq-blur:\s*(\d+)px/.exec(css.slice(0, css.indexOf("@layer components")))![1],
    );
    expect(chrome).toBeGreaterThan(base);
  });

  it(".lq-field inverts the recipe into a recessed inset shadow", () => {
    expect(ruleBody(".lq-field", LAYER)).toContain("inset");
  });

  it(".lq-field shows a focus rim so keyboard users can see the active field", () => {
    expect(() => ruleBody("\\.lq-field:focus-within", LAYER)).not.toThrow();
  });

  it(".lq-tint composes the tint over the base fill rather than replacing it", () => {
    const tint = ruleBody(".lq-tint", LAYER);
    expect(tint).toContain("var(--lq-tint)");
    expect(tint).toContain("var(--lq-fill)");
  });
});

describe("motion", () => {
  it("defines the shared easing curves", () => {
    for (const name of ["--ease-out", "--ease-spring", "--ease-liquid"]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it("honours prefers-reduced-motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("neutralises both animation and transition under reduced motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.001ms !important");
    expect(block).toContain("transition-duration: 0.001ms !important");
  });

  it("stops looping animations under reduced motion", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    // Without this, an infinite animation still loops at 0.001ms — pure CPU burn.
    expect(block).toContain("animation-iteration-count: 1 !important");
  });

  it("defines the entrance and sweep keyframes the components reference", () => {
    for (const name of ["bubble-in", "lq-sweep", "orb-drift", "shimmer"]) {
      expect(css).toContain(`@keyframes ${name}`);
    }
  });
});

describe("ambient light field", () => {
  it("paints drifting orbs behind everything so the glass has something to refract", () => {
    const before = ruleBody("body::before");
    expect(before).toContain("position: fixed");
    expect(before).toMatch(/z-index:\s*-\d/);
    expect(before).toContain("orb-drift");
  });

  it("keeps the orb layer click-through", () => {
    expect(ruleBody("body::before")).toContain("pointer-events: none");
  });

  it("gives body an explicit background so the glass never sits on nothing", () => {
    expect(ruleBody("body")).toContain("background-color:");
  });
});

describe("source hygiene", () => {
  const files = sourceFiles();
  /** Matches the bare `lq` class, not `lq-press`/`lq-flat`/etc. */
  const BARE_LQ = /(?<![\w-])lq(?![\w-])/;

  it("scans a meaningful number of sources", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  /**
   * Collect the class tokens of every `className=` expression in a source file.
   *
   * Classes are frequently assembled with `cn("a", cond ? "b" : "c")`, so a
   * regex over `className="..."` alone silently matches nothing and the check
   * passes vacuously. Instead: find each `className=`, take the balanced
   * expression that follows, and union every string literal inside it.
   */
  function classNameSets(src: string): string[][] {
    const sets: string[][] = [];
    for (let i = src.indexOf("className="); i !== -1; i = src.indexOf("className=", i + 1)) {
      let expr: string;
      const after = src[i + "className=".length];
      if (after === '"') {
        const end = src.indexOf('"', i + "className=".length + 1);
        expr = src.slice(i + "className=".length, end + 1);
      } else if (after === "{") {
        let depth = 0;
        let j = i + "className=".length;
        for (; j < src.length; j++) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        expr = src.slice(i + "className=".length, j + 1);
      } else continue;
      const literals = [...expr.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
      const tokens = literals.flatMap((l) => l.split(/\s+/)).filter(Boolean);
      if (tokens.length) sets.push(tokens);
    }
    return sets;
  }

  const allClassNameSets = files.flatMap((f) => classNameSets(readFileSync(f, "utf8")));
  const glassSets = allClassNameSets.filter((set) => set.some((c) => BARE_LQ.test(c)));

  it("the className scanner actually finds glass elements (guards a vacuous pass)", () => {
    expect(allClassNameSets.length).toBeGreaterThan(200);
    expect(glassSets.length).toBeGreaterThan(30);
  });

  it("never puts a bg-* utility on a .lq element (the two backgrounds fight)", () => {
    // `.lq` drives its fill from --lq-bg / --lq-fill. A plain bg-* utility on
    // the same element overrides one of them and breaks the recipe; use
    // --lq-bg or --lq-tint instead. Interaction states (hover:/focus:) are fine.
    const offenders = glassSets
      .flatMap((set) => set.filter((c) => /^bg-/.test(c) && !c.includes(":")))
      .filter((c, i, a) => a.indexOf(c) === i);
    expect(offenders).toEqual([]);
  });

  it("every lq-tint element supplies a tint or accepts the documented default", () => {
    // Purely informational guard: --lq-tint always resolves because :root
    // defines a default, but an explicit tint is what makes tones distinct.
    const tinted = glassSets.filter((set) => set.includes("lq-tint"));
    expect(tinted.length).toBeGreaterThan(5);
  });

  it("has retired the pre-glass input recipe everywhere", () => {
    const offenders = files.filter((f) =>
      readFileSync(f, "utf8").includes("focus:border-vault-500"),
    );
    expect(offenders).toEqual([]);
  });

  it("has retired the pre-glass `border-line` surface treatment", () => {
    const offenders = files.filter((f) => /\bborder-line\b/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("gives every text field the shared recessed-glass treatment", () => {
    // Either the shared `inputCls` (form fields) or `lq-field` directly (the
    // pill-shaped chat/assistant composers, which need a different radius).
    // A file with neither is hand-rolling a field and will drift.
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!/<(input|textarea|select)\b/.test(src)) continue;
      if (!src.includes("inputCls") && !src.includes("lq-field")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("imports inputCls from lib, not the component file (react-refresh boundary)", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toContain('inputCls } from "../components/ui/Field"');
    }
  });
});
