// @vitest-environment jsdom
/**
 * Navigation chrome: ListItem rows, the floating AppBar capsule, the bottom
 * nav's sliding pill, and the glass Sheet.
 *
 * The nav and app bar pull in TanStack Query and the auth/assistant contexts,
 * so `src/lib/api` is stubbed at module level — these tests are about layout
 * and a11y contracts, not network behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileText } from "lucide-react";
import { ListIcon, ListItem } from "../src/components/ui/ListItem";
import { Sheet } from "../src/components/ui/Sheet";
import { calcFraction, classes, renderUi } from "./helpers/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({ unreadCount: 0 });
});

describe("ListItem", () => {
  it("renders its title", () => {
    renderUi(<ListItem title="Ravi — Passport" />);
    expect(screen.getByText("Ravi — Passport")).toBeInTheDocument();
  });

  it("renders an optional subtitle", () => {
    renderUi(<ListItem title="Passport" subtitle="expires in 15 days" />);
    expect(screen.getByText("expires in 15 days")).toBeInTheDocument();
  });

  it("omits the subtitle element when not given", () => {
    const { container } = renderUi(<ListItem title="Passport" />);
    expect(container.textContent).toBe("Passport");
  });

  it("renders as a link when `to` is set", () => {
    renderUi(<ListItem to="/documents/1" title="Passport" />);
    expect(screen.getByRole("link", { name: /Passport/ })).toHaveAttribute(
      "href",
      "/documents/1",
    );
  });

  it("renders as a plain div when `to` is absent", () => {
    renderUi(<ListItem title="Passport" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a chevron on navigable rows by default", () => {
    const { container } = renderUi(<ListItem to="/x" title="Passport" />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("shows no chevron on non-navigable rows", () => {
    const { container } = renderUi(<ListItem title="Passport" />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("respects showChevron={false} on a navigable row", () => {
    const { container } = renderUi(
      <ListItem to="/x" title="Passport" showChevron={false} />,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("renders leading and trailing slots", () => {
    renderUi(
      <ListItem
        title="Passport"
        leading={<span data-testid="lead" />}
        trailing={<span data-testid="trail" />}
      />,
    );
    expect(screen.getByTestId("lead")).toBeInTheDocument();
    expect(screen.getByTestId("trail")).toBeInTheDocument();
  });

  it("meets the 44px minimum tap target", () => {
    const { container } = renderUi(<ListItem to="/x" title="Passport" />);
    const cls = [...classes(container.firstElementChild!)].find((c) =>
      c.startsWith("min-h-"),
    )!;
    expect(Number(cls.replace("min-h-", "")) * 4).toBeGreaterThanOrEqual(44);
  });

  it("truncates a long title rather than wrapping the row", () => {
    const { container } = renderUi(<ListItem title={"x".repeat(200)} />);
    const titleEl = container.querySelector(".truncate");
    expect(titleEl).not.toBeNull();
  });

  it("only navigable rows get a hover state", () => {
    const { container: link } = renderUi(<ListItem to="/x" title="a" />);
    const { container: plain } = renderUi(<ListItem title="a" />);
    expect(link.firstElementChild!.className).toContain("hover:");
    expect(plain.firstElementChild!.className).not.toContain("hover:");
  });
});

describe("ListIcon", () => {
  it("is a round tinted glass bubble", () => {
    const { container } = render(
      <ListIcon>
        <FileText />
      </ListIcon>,
    );
    const cls = classes(container.firstElementChild!);
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("lq-tint")).toBe(true);
    expect(cls.has("rounded-full")).toBe(true);
  });

  it.each(["vault", "info", "success", "warning", "danger", "neutral"] as const)(
    "tone %s renders",
    (tone) => {
      const { container } = render(
        <ListIcon tone={tone}>
          <FileText />
        </ListIcon>,
      );
      expect(container.firstElementChild).not.toBeNull();
    },
  );

  it("every tone resolves to a distinct colour token", () => {
    const tones = ["vault", "info", "success", "warning", "danger", "neutral"] as const;
    const seen = tones.map((tone) => {
      const { container, unmount } = render(
        <ListIcon tone={tone}>
          <FileText />
        </ListIcon>,
      );
      const c = [...classes(container.firstElementChild!)].find((x) =>
        x.startsWith("[--lq-tint:"),
      )!;
      unmount();
      return c;
    });
    expect(new Set(seen).size).toBe(tones.length);
  });

  it("defaults to the vault tone", () => {
    const { container } = render(
      <ListIcon>
        <FileText />
      </ListIcon>,
    );
    expect(classes(container.firstElementChild!).has("text-vault-300")).toBe(true);
  });

  it("renders its children", () => {
    render(
      <ListIcon>
        <span data-testid="icon" />
      </ListIcon>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});

describe("Sheet", () => {
  const noop = () => {};

  it("renders nothing while closed", () => {
    const { container } = render(
      <Sheet open={false} onClose={noop} title="Assistant">
        body
      </Sheet>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a modal dialog when open", () => {
    render(
      <Sheet open onClose={noop} title="Assistant">
        body
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("labels the dialog with its own title", () => {
    render(
      <Sheet open onClose={noop} title="Assistant">
        body
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Assistant" })).toBeInTheDocument();
  });

  it("renders its children", () => {
    render(
      <Sheet open onClose={noop} title="Assistant">
        <p>thread goes here</p>
      </Sheet>,
    );
    expect(screen.getByText("thread goes here")).toBeInTheDocument();
  });

  it("closes on the close button", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Assistant">
        body
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a scrim tap", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Assistant">
        body
      </Sheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Assistant">
        body
      </Sheet>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Assistant">
        body
      </Sheet>,
    );
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not listen for Escape while closed", () => {
    const onClose = vi.fn();
    render(
      <Sheet open={false} onClose={onClose} title="Assistant">
        body
      </Sheet>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes its key listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Sheet open onClose={onClose} title="Assistant">
        body
      </Sheet>,
    );
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is chrome-grade glass so the page behind is properly obscured", () => {
    render(
      <Sheet open onClose={noop} title="Assistant">
        body
      </Sheet>,
    );
    const cls = classes(screen.getByRole("dialog"));
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("lq-chrome")).toBe(true);
  });

  it("sits above the bottom nav", () => {
    const { container } = render(
      <Sheet open onClose={noop} title="Assistant">
        body
      </Sheet>,
    );
    const z = [...classes(container.firstElementChild!)].find((c) =>
      /^z-\d+$/.test(c),
    )!;
    // BottomNav is z-30; the sheet must win.
    expect(Number(z.replace("z-", ""))).toBeGreaterThan(30);
  });
});

describe("BottomNav", () => {
  async function renderNav(route: string) {
    const { BottomNav } = await import("../src/components/BottomNav");
    return renderUi(<BottomNav />, { route, withProviders: true });
  }

  it("renders all five primary tabs", async () => {
    await renderNav("/");
    for (const label of ["Home", "Docs", "Chat", "Activity", "Family"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("exposes a labelled navigation landmark", async () => {
    await renderNav("/");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it.each([
    ["/", 0],
    ["/documents", 1],
    ["/chat", 2],
    ["/notifications", 3],
    ["/family", 4],
  ])("puts the pill on the tab owning %s", async (route, index) => {
    const { container } = await renderNav(route);
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).toBeCloseTo(index / 5, 5);
  });

  it("keeps the pill on the owning tab for nested routes", async () => {
    const { container } = await renderNav("/documents/abc-123");
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).toBeCloseTo(1 / 5, 5);
  });

  it("matches Home exactly so it does not own every route", async () => {
    const { container } = await renderNav("/documents");
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).not.toBeCloseTo(0, 5);
  });

  it("renders no pill on a route no tab owns", async () => {
    const { container } = await renderNav("/settings");
    expect(container.querySelector("span.lq-primary")).toBeNull();
  });

  it("uses one sliding pill, not five independent highlights", async () => {
    const { container } = await renderNav("/chat");
    expect(container.querySelectorAll("span.lq-primary")).toHaveLength(1);
  });

  it("sizes the pill to one of five tabs", async () => {
    const { container } = await renderNav("/");
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.width)).toBeCloseTo(1 / 5, 5);
  });

  it("keeps the pill absolutely positioned over the capsule", async () => {
    const { container } = await renderNav("/");
    const pill = container.querySelector("span.lq-primary")!;
    expect(classes(pill).has("absolute")).toBe(true);
  });

  it("every tab meets the 44px minimum tap target", async () => {
    await renderNav("/");
    for (const link of screen.getAllByRole("link")) {
      const cls = [...classes(link)].find((c) => c.startsWith("min-h-"))!;
      expect(Number(cls.replace("min-h-", "")) * 4).toBeGreaterThanOrEqual(44);
    }
  });

  it("shows an unread badge on Activity", async () => {
    apiMock.mockResolvedValue({ unreadCount: 4 });
    await renderNav("/");
    await waitFor(() =>
      expect(screen.getByLabelText("4 unread notifications")).toBeInTheDocument(),
    );
  });

  it("caps the unread badge at 9+", async () => {
    apiMock.mockResolvedValue({ unreadCount: 42 });
    await renderNav("/");
    await waitFor(() => expect(screen.getByText("9+")).toBeInTheDocument());
  });

  it("shows no badge at zero unread", async () => {
    apiMock.mockResolvedValue({ unreadCount: 0 });
    const { container } = await renderNav("/");
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(container.querySelector("[aria-label$='unread notifications']")).toBeNull();
  });

  it("survives the unread query failing", async () => {
    apiMock.mockRejectedValue(new Error("offline"));
    await renderNav("/");
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument(),
    );
  });

  it("is a floating capsule that lets taps through around it", async () => {
    const { container } = await renderNav("/");
    const nav = container.querySelector("nav")!;
    const list = container.querySelector("ul")!;
    expect(classes(nav).has("pointer-events-none")).toBe(true);
    expect(classes(list).has("pointer-events-auto")).toBe(true);
  });
});
