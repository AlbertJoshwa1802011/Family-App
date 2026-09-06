// @vitest-environment jsdom
/**
 * Contract tests for the liquid-glass primitives.
 *
 * These assert the *contract* other code depends on — the shared `.lq` recipe,
 * the variant/tone maps, the accessibility attributes and the prop names
 * (`loading`, not `isLoading`; `back`, not `showBack`) — rather than pixel
 * output. If a future change swaps a primitive's implementation, these should
 * still pass as long as the contract holds.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Bell, FolderOpen, Plus } from "lucide-react";
import { Card } from "../src/components/ui/Card";
import { Button } from "../src/components/ui/Button";
import { Badge } from "../src/components/ui/Badge";
import { Avatar } from "../src/components/ui/Avatar";
import { Skeleton } from "../src/components/ui/Skeleton";
import { Spinner } from "../src/components/ui/Spinner";
import { Page } from "../src/components/ui/Page";
import { Fab } from "../src/components/ui/Fab";
import { EmptyState } from "../src/components/ui/EmptyState";
import { classes, expectGlass } from "./helpers/render";

describe("Card", () => {
  it("is a liquid-glass bubble by default", () => {
    const { container } = render(<Card data-testid="c">body</Card>);
    const el = container.firstElementChild!;
    expectGlass(el);
    expect(classes(el).has("rounded-bubble")).toBe(true);
  });

  it("renders its children", () => {
    render(<Card>hello world</Card>);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it.each([
    ["glass", ["lq"], ["lq-flat", "lq-raised"]],
    ["flat", ["lq", "lq-flat"], ["lq-raised"]],
    ["raised", ["lq", "lq-raised"], ["lq-flat"]],
  ] as const)("variant %s applies the right modifiers", (variant, present, absent) => {
    const { container } = render(<Card variant={variant} />);
    const cls = classes(container.firstElementChild!);
    for (const c of present) expect(cls.has(c)).toBe(true);
    for (const c of absent) expect(cls.has(c)).toBe(false);
  });

  it("flat drops backdrop blur so long lists stay smooth", () => {
    const { container } = render(<Card variant="flat" />);
    expect(classes(container.firstElementChild!).has("lq-flat")).toBe(true);
  });

  it("tint sets the --lq-tint custom property and the tint modifier", () => {
    const { container } = render(<Card tint="var(--color-info)" />);
    const el = container.firstElementChild as HTMLElement;
    expect(classes(el).has("lq-tint")).toBe(true);
    expect(el.style.getPropertyValue("--lq-tint")).toBe("var(--color-info)");
  });

  it("omits the tint modifier when no tint is given", () => {
    const { container } = render(<Card />);
    expect(classes(container.firstElementChild!).has("lq-tint")).toBe(false);
  });

  it("tint does not clobber a caller-supplied style", () => {
    const { container } = render(<Card tint="#ff0000" style={{ marginTop: "8px" }} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.marginTop).toBe("8px");
    expect(el.style.getPropertyValue("--lq-tint")).toBe("#ff0000");
  });

  it("interactive adds the liquid press response", () => {
    const { container } = render(<Card interactive />);
    expect(classes(container.firstElementChild!).has("lq-press")).toBe(true);
  });

  it("is not interactive by default", () => {
    const { container } = render(<Card />);
    expect(classes(container.firstElementChild!).has("lq-press")).toBe(false);
  });

  it("merges a caller className without dropping the recipe", () => {
    const { container } = render(<Card className="p-4 custom-thing" />);
    const cls = classes(container.firstElementChild!);
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("p-4")).toBe(true);
    expect(cls.has("custom-thing")).toBe(true);
  });

  it("forwards arbitrary div props", () => {
    render(<Card aria-label="stats" role="group" />);
    expect(screen.getByRole("group", { name: "stats" })).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("renders a real <button> with its label", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInstanceOf(HTMLButtonElement);
  });

  it.each(["primary", "secondary", "danger", "white"] as const)(
    "%s variant is built on the glass recipe",
    (variant) => {
      render(<Button variant={variant}>x</Button>);
      expectGlass(screen.getByRole("button"));
    },
  );

  it("ghost is deliberately not glass — it must stay invisible until hovered", () => {
    render(<Button variant="ghost">x</Button>);
    expect(classes(screen.getByRole("button")).has("lq")).toBe(false);
  });

  it.each([
    ["primary", "lq-primary"],
    ["danger", "lq-danger"],
    ["white", "lq-white"],
  ] as const)("%s variant uses the %s skin", (variant, skin) => {
    render(<Button variant={variant}>x</Button>);
    expect(classes(screen.getByRole("button")).has(skin)).toBe(true);
  });

  it("defaults to the primary variant", () => {
    render(<Button>x</Button>);
    expect(classes(screen.getByRole("button")).has("lq-primary")).toBe(true);
  });

  it.each([
    ["sm", "min-h-9"],
    ["md", "min-h-11"],
    ["lg", "min-h-13"],
  ] as const)("size %s sets a %s tap target", (size, cls) => {
    render(<Button size={size}>x</Button>);
    expect(classes(screen.getByRole("button")).has(cls)).toBe(true);
  });

  it("defaults to a 44px-plus tap target (md)", () => {
    render(<Button>x</Button>);
    expect(classes(screen.getByRole("button")).has("min-h-11")).toBe(true);
  });

  it("every size meets the 36px minimum tap target", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const { unmount } = render(<Button size={size}>x</Button>);
      const cls = [...classes(screen.getByRole("button"))].find((c) =>
        c.startsWith("min-h-"),
      )!;
      expect(Number(cls.replace("min-h-", "")) * 4).toBeGreaterThanOrEqual(36);
      unmount();
    }
  });

  it("is a pill, not a rounded rectangle", () => {
    render(<Button>x</Button>);
    expect(classes(screen.getByRole("button")).has("rounded-full")).toBe(true);
  });

  it("loading disables the button and marks it busy", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("loading swaps the leading icon for a spinner", () => {
    const { rerender } = render(
      <Button leadingIcon={<span data-testid="icon" />}>Save</Button>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    rerender(
      <Button loading leadingIcon={<span data-testid="icon" />}>
        Save
      </Button>,
    );
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
  });

  it("is not busy when idle", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "false");
  });

  it("disabled prop still disables without loading", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("does not fire onClick while loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick when idle", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fullWidth stretches the button", () => {
    render(<Button fullWidth>x</Button>);
    expect(classes(screen.getByRole("button")).has("w-full")).toBe(true);
  });

  it("is not full width by default", () => {
    render(<Button>x</Button>);
    expect(classes(screen.getByRole("button")).has("w-full")).toBe(false);
  });

  it("keeps a visible focus ring for keyboard users", () => {
    render(<Button>x</Button>);
    const cls = [...classes(screen.getByRole("button"))];
    expect(cls.some((c) => c.startsWith("focus-visible:ring"))).toBe(true);
  });

  it("forwards type=submit", () => {
    render(<Button type="submit">Go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>12d left</Badge>);
    expect(screen.getByText("12d left")).toBeInTheDocument();
  });

  it.each(["neutral", "success", "warning", "danger", "info", "vault"] as const)(
    "tone %s is tinted glass",
    (tone) => {
      const { container } = render(<Badge tone={tone}>x</Badge>);
      const cls = classes(container.firstElementChild!);
      expect(cls.has("lq")).toBe(true);
      expect(cls.has("lq-tint")).toBe(true);
    },
  );

  it.each([
    ["success", "text-success"],
    ["warning", "text-warning"],
    ["danger", "text-danger"],
    ["info", "text-info"],
    ["vault", "text-vault-300"],
    ["neutral", "text-fg-muted"],
  ] as const)("tone %s uses its own text colour", (tone, text) => {
    const { container } = render(<Badge tone={tone}>x</Badge>);
    expect(classes(container.firstElementChild!).has(text)).toBe(true);
  });

  it("every tone resolves to a distinct text colour", () => {
    const tones = ["neutral", "success", "warning", "danger", "info", "vault"] as const;
    const colours = tones.map((tone) => {
      const { container, unmount } = render(<Badge tone={tone}>x</Badge>);
      // skip the font-size utility — we want the colour token
      const c = [...classes(container.firstElementChild!)].find((x) =>
        /^text-(?!xs$|sm$|base$|lg$|xl$)/.test(x),
      )!;
      unmount();
      return c;
    });
    expect(new Set(colours).size).toBe(tones.length);
  });

  it("defaults to the neutral tone", () => {
    const { container } = render(<Badge>x</Badge>);
    expect(classes(container.firstElementChild!).has("text-fg-muted")).toBe(true);
  });

  it("neutral is not tinted white — that read brighter than the row text", () => {
    const { container } = render(<Badge>x</Badge>);
    expect(classes(container.firstElementChild!).has("[--lq-tint:#ffffff]")).toBe(false);
  });

  it("never wraps mid-badge", () => {
    const { container } = render(<Badge>Expires in 30 days</Badge>);
    expect(classes(container.firstElementChild!).has("whitespace-nowrap")).toBe(true);
  });

  it("uses lq-flat so a long list of badges does not stack blur layers", () => {
    const { container } = render(<Badge>x</Badge>);
    expect(classes(container.firstElementChild!).has("lq-flat")).toBe(true);
  });
});

describe("Avatar", () => {
  it("derives initials from a two-part name", () => {
    render(<Avatar name="Ravi Sharma" />);
    expect(screen.getByText("RS")).toBeInTheDocument();
  });

  it("uses one letter for a single-word name", () => {
    render(<Avatar name="Priya" />);
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("falls back to the email local-part when there is no name", () => {
    render(<Avatar email="ravi.sharma@example.com" />);
    expect(screen.getByText("RS")).toBeInTheDocument();
  });

  it("splits email local-parts on dots, underscores and hyphens", () => {
    for (const email of ["a.b@x.com", "a_b@x.com", "a-b@x.com"]) {
      const { unmount } = render(<Avatar email={email} />);
      expect(screen.getByText("AB")).toBeInTheDocument();
      unmount();
    }
  });

  it("prefers the name over the email", () => {
    render(<Avatar name="Ravi Sharma" email="zz@example.com" />);
    expect(screen.getByText("RS")).toBeInTheDocument();
  });

  it("ignores a whitespace-only name", () => {
    render(<Avatar name="   " email="kiran@example.com" />);
    expect(screen.getByText("K")).toBeInTheDocument();
  });

  it("renders '?' when it has nothing to work with", () => {
    render(<Avatar />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("uppercases initials from a lowercase name", () => {
    render(<Avatar name="ravi sharma" />);
    expect(screen.getByText("RS")).toBeInTheDocument();
  });

  it("renders an <img> when a src is supplied", () => {
    render(<Avatar name="Ravi" src="https://example.com/a.png" />);
    const img = screen.getByRole("img", { name: "Ravi" });
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
  });

  it("falls back to alt text when the image has no name", () => {
    render(<Avatar src="https://example.com/a.png" />);
    expect(screen.getByRole("img", { name: "avatar" })).toBeInTheDocument();
  });

  it("hides the initials fallback from screen readers", () => {
    const { container } = render(<Avatar name="Ravi Sharma" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("the initials fallback is a tinted glass circle", () => {
    const { container } = render(<Avatar name="Ravi Sharma" />);
    const cls = classes(container.firstElementChild!);
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("rounded-full")).toBe(true);
  });

  it("accepts a size override", () => {
    const { container } = render(<Avatar name="Ravi" className="size-7" />);
    expect(classes(container.firstElementChild!).has("size-7")).toBe(true);
  });
});

describe("Skeleton", () => {
  it("uses the shimmer class", () => {
    const { container } = render(<Skeleton />);
    expect(classes(container.firstElementChild!).has("skeleton")).toBe(true);
  });

  it("is hidden from assistive tech — it is pure placeholder chrome", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts shape overrides", () => {
    const { container } = render(<Skeleton className="size-10 rounded-full" />);
    const cls = classes(container.firstElementChild!);
    expect(cls.has("size-10")).toBe(true);
    expect(cls.has("rounded-full")).toBe(true);
  });
});

describe("Spinner", () => {
  it("animates and is decorative only", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.getAttribute("class")).toContain("animate-spin");
  });
});

describe("Page", () => {
  it("constrains to the mobile column and clears the floating nav", () => {
    const { container } = render(<Page>content</Page>);
    const cls = classes(container.firstElementChild!);
    expect(cls.has("max-w-md")).toBe(true);
    expect(cls.has("mx-auto")).toBe(true);
    const pb = [...cls].find((c) => c.startsWith("pb-"))!;
    // The nav capsule plus its margins is ~84px; padding must exceed that.
    expect(Number(pb.replace("pb-", "")) * 4).toBeGreaterThan(84);
  });

  it("renders children", () => {
    render(<Page>hello</Page>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});

describe("Fab", () => {
  it("exposes its label to screen readers", () => {
    render(<Fab icon={Plus} label="Add document" />);
    expect(screen.getByRole("button", { name: "Add document" })).toBeInTheDocument();
  });

  it("is a raised primary bubble", () => {
    render(<Fab icon={Plus} label="Add" />);
    const cls = classes(screen.getByRole("button"));
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("lq-raised")).toBe(true);
    expect(cls.has("lq-primary")).toBe(true);
    expect(cls.has("rounded-full")).toBe(true);
  });

  it("floats clear of the bottom nav", () => {
    render(<Fab icon={Plus} label="Add" />);
    const cls = classes(screen.getByRole("button"));
    expect(cls.has("fixed")).toBe(true);
    const bottom = [...cls].find((c) => /^bottom-\d+$/.test(c))!;
    expect(Number(bottom.replace("bottom-", "")) * 4).toBeGreaterThanOrEqual(84);
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<Fab icon={Plus} label="Add" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides its icon from the accessibility tree (the label carries meaning)", () => {
    const { container } = render(<Fab icon={Bell} label="Alerts" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("EmptyState", () => {
  it("renders the title as a heading", () => {
    render(<EmptyState icon={FolderOpen} title="No documents yet" />);
    expect(
      screen.getByRole("heading", { name: "No documents yet" }),
    ).toBeInTheDocument();
  });

  it("renders the optional description", () => {
    render(
      <EmptyState icon={FolderOpen} title="Empty" description="Add something." />,
    );
    expect(screen.getByText("Add something.")).toBeInTheDocument();
  });

  it("omits the description element when not given", () => {
    const { container } = render(<EmptyState icon={FolderOpen} title="Empty" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders an optional action", () => {
    render(
      <EmptyState
        icon={FolderOpen}
        title="Empty"
        action={<Button>Add document</Button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Add document" })).toBeInTheDocument();
  });

  it("is a glass bubble that animates in", () => {
    const { container } = render(<EmptyState icon={FolderOpen} title="Empty" />);
    const cls = classes(container.firstElementChild!);
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("bubble-in")).toBe(true);
  });

  it("hides its decorative icon from screen readers", () => {
    const { container } = render(<EmptyState icon={FolderOpen} title="Empty" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
