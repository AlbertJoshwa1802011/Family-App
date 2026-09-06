// @vitest-environment jsdom
/**
 * One test per defect found while reviewing the liquid-glass UI on a real phone
 * viewport. Each is named after the symptom so a future failure explains itself.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { AppBar } from "../src/components/ui/AppBar";
import { Badge } from "../src/components/ui/Badge";
import { eventTypeColor } from "../src/lib/eventTime";
import { classes, renderUi } from "./helpers/render";

const apiMock = vi.hoisted(() => vi.fn().mockResolvedValue({ unreadCount: 0 }));
vi.mock("../src/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));
// AppBar renders AssistantButton, which needs auth + assistant context.
vi.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "a@b.c", name: "Ravi Sharma" },
    families: [],
    activeFamily: { id: "f1", name: "The Sharmas", role: "owner" },
    setActiveFamilyId: vi.fn(),
    isLoading: false,
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
}));

describe("regression: nav pill rendered as a giant misplaced blob", () => {
  // Cause: unlayered `.lq { position: relative }` beat Tailwind's `absolute`.
  it("the sliding pill keeps its absolute positioning class", async () => {
    const { BottomNav } = await import("../src/components/BottomNav");
    const { container } = renderUi(<BottomNav />, { route: "/", withProviders: true });
    const pill = container.querySelector("span.lq-primary")!;
    expect(classes(pill).has("absolute")).toBe(true);
  });

  it("the glass recipe is layered so utilities can still override it", () => {
    const css = readFileSync("src/index.css", "utf8");
    const layerAt = css.indexOf("@layer components");
    const lqAt = css.indexOf(".lq {");
    expect(layerAt).toBeGreaterThan(-1);
    expect(lqAt).toBeGreaterThan(layerAt);
  });
});

describe("regression: search icons vanished behind the glass field", () => {
  // Cause: backdrop-filter makes the field a stacking context that paints at
  // the positioned-descendant level, covering earlier absolute siblings.
  it.each(["src/pages/Documents.tsx", "src/pages/Tasks.tsx"])(
    "%s lifts its search overlays above the field",
    (file) => {
      const src = readFileSync(file, "utf8");
      const overlays = [...src.matchAll(/className="([^"]*absolute[^"]*top-1\/2[^"]*)"/g)];
      expect(overlays.length).toBeGreaterThan(0);
      for (const [, cls] of overlays) {
        expect(cls).toMatch(/\bz-\d+\b/);
      }
    },
  );
});

describe("regression: settings toggle knob overflowed its track", () => {
  // Cause: the knob relied on its abs-child static position, which resolved to
  // 22px (half the track) rather than 0.
  it("pins the knob with an explicit left", () => {
    const src = readFileSync("src/pages/Settings.tsx", "utf8");
    const knob = /"absolute top-0\.5([^"]*)"/.exec(src);
    expect(knob).not.toBeNull();
    expect(knob![1]).toContain("left-");
  });

  it("keeps the knob inside a 44px track at both ends", () => {
    const src = readFileSync("src/pages/Settings.tsx", "utf8");
    // track w-11 = 44px, knob size-5 = 20px, left-0.5 = 2px
    expect(src).toContain("w-11");
    expect(src).toContain("size-5");
    const on = /translate-x-(\d+)"/.exec(src);
    expect(on).not.toBeNull();
    const travel = Number(on![1]) * 4;
    expect(2 + travel + 20).toBeLessThanOrEqual(44);
  });
});

describe("regression: document titles hard-clipped mid-word", () => {
  // Cause: text-overflow:ellipsis needs inline text; an inline-flex wrapper
  // inside ListItem's `truncate` container clips with no ellipsis.
  it("Documents truncates the title text node itself", () => {
    const src = readFileSync("src/pages/Documents.tsx", "utf8");
    expect(src).toContain('<span className="truncate">{doc.title}</span>');
  });

  it("keeps the private-document lock from being squeezed away", () => {
    const src = readFileSync("src/pages/Documents.tsx", "utf8");
    expect(src).toMatch(/Lock[\s\S]{0,120}shrink-0/);
  });
});

describe("regression: native date pickers rendered black-on-black", () => {
  it("the shared field declares a dark colour-scheme", async () => {
    const { inputCls } = await import("../src/lib/fieldCls");
    expect(inputCls).toContain("[color-scheme:dark]");
  });
});

describe("regression: neutral badges read brighter than the row text", () => {
  it("neutral is tinted with a muted token, not white", () => {
    const { container } = render(<Badge>other</Badge>);
    const cls = [...classes(container.firstElementChild!)];
    expect(cls).toContain("[--lq-tint:var(--color-fg-subtle)]");
  });
});

describe("eventTypeColor tint (feeds --lq-tint)", () => {
  it.each(["gathering", "appointment", "milestone", "other"])(
    "%s exposes a CSS colour, not a class",
    (type) => {
      const { tint } = eventTypeColor(type);
      expect(tint).not.toMatch(/^(bg|text|border)-/);
      expect(tint).toMatch(/^(#|var\(|rgb|hsl|oklch)/);
    },
  );

  it("keeps the legacy class fields for non-glass surfaces", () => {
    const c = eventTypeColor("gathering");
    expect(c.bg).toMatch(/^bg-/);
    expect(c.text).toMatch(/^text-/);
    expect(c.dot).toMatch(/^bg-/);
  });
});

describe("AppBar", () => {
  it("renders the title as the page heading", () => {
    renderUi(<AppBar title="Documents" />, { withProviders: true });
    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
  });

  it("shows no back button by default", () => {
    renderUi(<AppBar title="Documents" />, { withProviders: true });
    expect(screen.queryByRole("button", { name: "Go back" })).not.toBeInTheDocument();
  });

  it("shows a labelled back button when `back` is set", () => {
    renderUi(<AppBar title="Task" back />, { withProviders: true });
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });

  it("uses the `back` prop name, not `showBack`", () => {
    // Documented in CLAUDE.md §3 — renaming it would silently disable every
    // back button in the app rather than failing to compile at the call sites.
    const src = readFileSync("src/components/ui/AppBar.tsx", "utf8");
    expect(src).toContain("back = false");
    expect(src).not.toContain("showBack");
  });

  it("renders a trailing slot", () => {
    renderUi(<AppBar title="Home" trailing={<span data-testid="bell" />} />, {
      withProviders: true,
    });
    expect(screen.getByTestId("bell")).toBeInTheDocument();
  });

  it("is a floating chrome capsule", () => {
    const { container } = renderUi(<AppBar title="Home" />, { withProviders: true });
    const capsule = container.querySelector(".lq-chrome")!;
    expect(classes(capsule).has("rounded-full")).toBe(true);
  });

  it("sticks to the top above page content but below the sheet", () => {
    const { container } = renderUi(<AppBar title="Home" />, { withProviders: true });
    const header = container.querySelector("header")!;
    const cls = classes(header);
    expect(cls.has("sticky")).toBe(true);
    const z = Number([...cls].find((c) => /^z-\d+$/.test(c))!.replace("z-", ""));
    expect(z).toBeLessThan(40);
  });

  it("respects the top safe area on notched phones", () => {
    const { container } = renderUi(<AppBar title="Home" />, { withProviders: true });
    expect(classes(container.querySelector("header")!).has("pt-safe")).toBe(true);
  });

  it("keeps the back button at a 40px-plus tap target", () => {
    renderUi(<AppBar title="Task" back />, { withProviders: true });
    const cls = [...classes(screen.getByRole("button", { name: "Go back" }))].find((c) =>
      c.startsWith("size-"),
    )!;
    expect(Number(cls.replace("size-", "")) * 4).toBeGreaterThanOrEqual(40);
  });
});
