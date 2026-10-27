// @vitest-environment jsdom
/**
 * Notifications UI: the per-type metadata contract, the Activity page
 * (grouping, filters, mark-read), the shared unread poll behind the bell and
 * nav badge, and the arrival banner that Layout mounts on every page.
 *
 * `src/lib/api` is stubbed at module level; each test routes paths to fixtures.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import {
  NOTIFICATION_META,
  groupNotifications,
  notificationGroup,
  notificationMeta,
  relativeTime,
} from "../src/lib/notificationMeta";
import { Notifications } from "../src/pages/Notifications";
import { NotificationBell } from "../src/components/NotificationBell";
import { BottomNav } from "../src/components/BottomNav";
import {
  NOTIFICATION_TOAST_MS,
  NotificationToast,
} from "../src/components/NotificationToast";
import type { NotificationItem } from "../src/lib/useUnreadNotifications";
import { renderUi } from "./helpers/render";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));
// AppBar renders AssistantButton, which needs auth context.
vi.mock("../src/context/AuthContext", () => {
  const auth = {
    user: { id: "u1", email: "a@b.c", name: "Ravi Sharma" },
    families: [],
    activeFamily: { id: "f1", name: "The Sharmas", role: "owner" },
    setActiveFamilyId: () => undefined,
    isLoading: false,
    isAuthenticated: true,
    signOut: () => undefined,
  };
  return { useAuth: () => auth, useOptionalAuth: () => auth };
});

const NOW = Math.floor(Date.now() / 1000);

function notif(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: over.id ?? crypto.randomUUID(),
    type: "event_invite",
    title: "Priya added you to \"Dinner\"",
    body: "Fri 7pm",
    link: "/calendar/events/e1",
    read: false,
    createdAt: NOW - 120,
    ...over,
  };
}

/** Route api paths to fixtures; unknown POSTs resolve ok. */
function serve(routes: { list?: NotificationItem[]; unread?: NotificationItem[] }) {
  apiMock.mockImplementation((path: string) => {
    if (path === "/notifications?unreadOnly=1") {
      const u = routes.unread ?? (routes.list ?? []).filter((n) => !n.read);
      return Promise.resolve({ notifications: u, unreadCount: u.length });
    }
    if (path === "/notifications") {
      const l = routes.list ?? [];
      return Promise.resolve({ notifications: l, unreadCount: l.filter((n) => !n.read).length });
    }
    return Promise.resolve({ ok: true });
  });
}

beforeEach(() => {
  apiMock.mockReset();
  serve({});
});

afterEach(() => {
  vi.useRealTimers();
});

// ── metadata contract ──────────────────────────────────────────────────────

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

/** Every `type: "x",\n title:` object in worker/ — the notification-write shape. */
function emittedTypes(): Set<string> {
  const re = /type:\s*"([a-z_]+)",\s*\n\s*title:/g;
  const out = new Set<string>();
  for (const f of walk(join(__dirname, "..", "worker"))) {
    for (const m of readFileSync(f, "utf8").matchAll(re)) out.add(m[1]);
  }
  return out;
}

describe("notification metadata", () => {
  it("the source scan actually finds the known writers (guards the regex)", () => {
    const types = emittedTypes();
    for (const t of ["expiry", "mention", "event_invite", "task_assigned", "meeting_followup"]) {
      expect(types).toContain(t);
    }
  });

  it("maps every notification type the worker emits", () => {
    const missing = [...emittedTypes()].filter((t) => !(t in NOTIFICATION_META));
    expect(missing).toEqual([]);
  });

  it("gives every mapped type a distinct-from-fallback icon, a label and a tint", () => {
    for (const [type, meta] of Object.entries(NOTIFICATION_META)) {
      expect(meta.icon, type).not.toBe(Bell);
      expect(meta.label.length, type).toBeGreaterThan(0);
      expect(meta.tint, type).toMatch(/^var\(--color-/);
    }
  });

  it("assigns scheduling types to calendar/tasks so filters catch them", () => {
    expect(notificationMeta("event_rsvp").category).toBe("calendar");
    expect(notificationMeta("event_cancelled").category).toBe("calendar");
    expect(notificationMeta("task_unassigned").category).toBe("tasks");
    expect(notificationMeta("mention").category).toBe("chat");
    expect(notificationMeta("expiry").category).toBe("documents");
  });

  it("falls back to a generic bell for unknown types instead of crashing", () => {
    const meta = notificationMeta("something_new");
    expect(meta.icon).toBe(Bell);
    expect(meta.category).toBeNull();
  });

  it("cancellations read as danger and RSVPs as success", () => {
    expect(notificationMeta("event_cancelled").tint).toContain("danger");
    expect(notificationMeta("event_rsvp").tint).toContain("success");
  });
});

describe("relativeTime", () => {
  it.each([
    [0, "just now"],
    [59, "just now"],
    [60, "1m ago"],
    [3599, "59m ago"],
    [3600, "1h ago"],
    [86399, "23h ago"],
    [86400, "1d ago"],
    [6 * 86400, "6d ago"],
  ])("%is ago → %s", (delta, expected) => {
    expect(relativeTime(NOW - delta, NOW)).toBe(expected);
  });

  it("switches to a short date after a week", () => {
    expect(relativeTime(NOW - 8 * 86400, NOW)).not.toMatch(/ago|now/);
  });

  it("clamps clock skew (future timestamps) to just now", () => {
    expect(relativeTime(NOW + 500, NOW)).toBe("just now");
  });
});

describe("notification grouping", () => {
  // Noon local time keeps "today" unambiguous regardless of the runner's TZ.
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const n = Math.floor(noon.getTime() / 1000);

  it("buckets by local calendar day", () => {
    expect(notificationGroup(n - 60, n)).toBe("Today");
    expect(notificationGroup(n - 13 * 3600, n)).toBe("Yesterday");
    expect(notificationGroup(n - 3 * 86400, n)).toBe("This week");
    expect(notificationGroup(n - 30 * 86400, n)).toBe("Earlier");
  });

  it("keeps order and emits each group once for a newest-first list", () => {
    const items = [
      { id: "a", createdAt: n - 10 },
      { id: "b", createdAt: n - 20 },
      { id: "c", createdAt: n - 13 * 3600 },
      { id: "d", createdAt: n - 40 * 86400 },
    ];
    const groups = groupNotifications(items, n);
    expect(groups.map((g) => g.group)).toEqual(["Today", "Yesterday", "Earlier"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("returns no groups for an empty list", () => {
    expect(groupNotifications([], n)).toEqual([]);
  });
});

// ── Activity page ──────────────────────────────────────────────────────────

describe("Notifications page", () => {
  it("shows the caught-up empty state with no notifications", async () => {
    renderUi(<Notifications />, { withProviders: true });
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Filter notifications" })).toBeNull();
  });

  it("labels each row with its type and tints the icon per type", async () => {
    serve({
      list: [
        notif({ id: "1", type: "event_cancelled", title: "Dinner cancelled" }),
        notif({ id: "2", type: "task_assigned", title: "New task for you" }),
      ],
    });
    renderUi(<Notifications />, { withProviders: true });
    expect(await screen.findByText("Dinner cancelled")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    const icons = screen.getAllByTestId("notification-icon");
    expect(icons[0].getAttribute("style")).toContain("--color-danger");
    expect(icons[0].className).toContain("lq");
  });

  it("groups rows under day headings", async () => {
    serve({
      list: [
        notif({ id: "1", title: "Fresh", createdAt: NOW - 30 }),
        notif({ id: "2", title: "Old", createdAt: NOW - 40 * 86400, read: true }),
      ],
    });
    renderUi(<Notifications />, { withProviders: true });
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByText("Fresh")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Earlier" })).getByText("Old")).toBeInTheDocument();
  });

  it("filters to unread and shows the unread count on the chip", async () => {
    serve({
      list: [
        notif({ id: "1", title: "New one" }),
        notif({ id: "2", title: "Seen one", read: true }),
      ],
    });
    renderUi(<Notifications />, { withProviders: true });
    await screen.findByText("Seen one");
    const chip = screen.getByRole("button", { name: /Unread\s*1/ });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("New one")).toBeInTheDocument();
    expect(screen.queryByText("Seen one")).toBeNull();
  });

  it("filters by category", async () => {
    serve({
      list: [
        notif({ id: "1", type: "mention", title: "Chat ping", link: "/chat" }),
        notif({ id: "2", type: "expiry", title: "Passport expiring", link: "/documents/d" }),
      ],
    });
    renderUi(<Notifications />, { withProviders: true });
    await screen.findByText("Chat ping");
    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByText("Passport expiring")).toBeInTheDocument();
    expect(screen.queryByText("Chat ping")).toBeNull();
  });

  it("shows a filter-specific empty state when a filter matches nothing", async () => {
    serve({ list: [notif({ read: true })] });
    renderUi(<Notifications />, { withProviders: true });
    await screen.findByText(/Priya added you/);
    fireEvent.click(screen.getByRole("button", { name: /^Unread/ }));
    expect(screen.getByText("Nothing unread")).toBeInTheDocument();
  });

  it("marks an unread row read when it is opened", async () => {
    serve({ list: [notif({ id: "n1" })] });
    renderUi(<Notifications />, { withProviders: true });
    fireEvent.click(await screen.findByRole("link", { name: /Priya added you/ }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/notifications/n1/read", { method: "POST" }),
    );
  });

  it("does not re-mark an already-read row", async () => {
    serve({ list: [notif({ id: "n1", read: true })] });
    renderUi(<Notifications />, { withProviders: true });
    fireEvent.click(await screen.findByRole("link", { name: /Priya added you/ }));
    expect(apiMock).not.toHaveBeenCalledWith("/notifications/n1/read", expect.anything());
  });

  it("renders link-less notifications as buttons", async () => {
    serve({ list: [notif({ link: null, title: "Heads up" })] });
    renderUi(<Notifications />, { withProviders: true });
    expect(await screen.findByRole("button", { name: /Heads up/ })).toBeInTheDocument();
  });

  it("Mark all posts read-all and only appears with unread items", async () => {
    serve({ list: [notif()] });
    renderUi(<Notifications />, { withProviders: true });
    fireEvent.click(await screen.findByRole("button", { name: /Mark all/ }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/notifications/read-all", { method: "POST" }),
    );
  });

  it("hides Mark all when everything is read", async () => {
    serve({ list: [notif({ read: true })] });
    renderUi(<Notifications />, { withProviders: true });
    await screen.findByText(/Priya added you/);
    expect(screen.queryByRole("button", { name: /Mark all/ })).toBeNull();
  });
});

// ── shared unread poll ─────────────────────────────────────────────────────

describe("unread badge (bell + bottom nav)", () => {
  it("bell and nav share one unread request", async () => {
    serve({ unread: [notif({ id: "1" }), notif({ id: "2" })] });
    renderUi(
      <>
        <NotificationBell />
        <BottomNav />
      </>,
      { withProviders: true },
    );
    expect(
      await screen.findByRole("link", { name: "Notifications, 2 unread" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("2 unread notifications")).toBeInTheDocument();
    const polls = apiMock.mock.calls.filter(([p]) => p === "/notifications?unreadOnly=1");
    expect(polls).toHaveLength(1);
  });

  it("caps the badge at 9+", async () => {
    serve({ unread: Array.from({ length: 12 }, (_, i) => notif({ id: String(i) })) });
    renderUi(<NotificationBell />, { withProviders: true });
    expect(await screen.findByText("9+")).toBeInTheDocument();
  });
});

// ── arrival banner ─────────────────────────────────────────────────────────

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderToast(route = "/") {
  return renderUi(
    <>
      <NotificationToast />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
    { withProviders: true, route },
  );
}

/** Seed the first poll, then make the next poll return `next`. */
async function arrive(initial: NotificationItem[], next: NotificationItem[]) {
  let call = 0;
  apiMock.mockImplementation((path: string) => {
    if (path === "/notifications?unreadOnly=1") {
      const list = call++ === 0 ? initial : next;
      return Promise.resolve({ notifications: list, unreadCount: list.length });
    }
    return Promise.resolve({ ok: true });
  });
}

describe("NotificationToast", () => {
  it("does not replay the existing backlog on first load", async () => {
    serve({ unread: [notif({ title: "Old news" })] });
    renderToast();
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops in a glass banner when a new notification arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const old = notif({ id: "old" });
    await arrive([old], [notif({ id: "new", type: "task_assigned", title: "Mom assigned you a task" }), old]);
    renderToast();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const banner = await screen.findByRole("status");
    expect(banner.className).toContain("lq-chrome");
    expect(within(banner).getByText("Mom assigned you a task")).toBeInTheDocument();
  });

  it("summarises a burst as +N more and opens the Activity page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await arrive([], [notif({ id: "a", title: "First" }), notif({ id: "b" }), notif({ id: "c" })]);
    renderToast();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(await screen.findByText("+2 more new")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open notification: First/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/notifications");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opening a single notification follows its link and marks it read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await arrive([], [notif({ id: "x", link: "/tasks/t1", title: "Do it" })]);
    renderToast();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    fireEvent.click(await screen.findByRole("button", { name: /Open notification: Do it/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/tasks/t1");
    expect(apiMock).toHaveBeenCalledWith("/notifications/x/read", { method: "POST" });
  });

  it("can be dismissed and auto-dismisses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await arrive([], [notif({ id: "x" })]);
    renderToast();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await screen.findByRole("status");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATION_TOAST_MS + 50);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("dismiss button closes it without navigating", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await arrive([], [notif({ id: "x" })]);
    renderToast("/family");
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent("/family");
  });

  it("stays quiet on the Activity page itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await arrive([], [notif({ id: "x" })]);
    renderToast("/notifications");
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
