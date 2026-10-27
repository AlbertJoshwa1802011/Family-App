// @vitest-environment jsdom
/**
 * Funds → Church panel: the live "with you" figure, what Mom is holding, exact
 * settle times, and the settle request carrying the chosen recipient.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { ChurchSettlementsPanel } from "../src/pages/money/ChurchSettlements";
import { renderUi } from "./helpers/render";

const SETTLED_AT = 1_793_000_000;

function snapshot() {
  return {
    configured: true,
    currency: "INR",
    fetchedAt: SETTLED_AT + 60,
    totals: {
      collectedMinor: 600_000,
      settledMinor: 450_000,
      withYouMinor: 150_000,
      withRecipientsMinor: 450_000,
      givenToChurchMinor: 0,
    },
    funds: [
      { slug: "christmas-2k26", name: "Christmas 2k26", collectedMinor: 300_000, purchasesMinor: 0, settledMinor: 250_000, withYouMinor: 50_000, overSettledMinor: 0, lastSettledAt: SETTLED_AT },
      { slug: "tech-contributions", name: "Tech Fund", collectedMinor: 300_000, purchasesMinor: 40_000, settledMinor: 200_000, withYouMinor: 100_000, overSettledMinor: 0, lastSettledAt: SETTLED_AT },
    ],
    holders: [
      {
        recipientId: "mom",
        name: "Mom",
        receivedMinor: 450_000,
        handedOverMinor: 0,
        holdingMinor: 450_000,
        openCount: 2,
        lastSettledAt: SETTLED_AT,
        byFund: [
          { fundSlug: "christmas-2k26", fundName: "Christmas 2k26", receivedMinor: 250_000, holdingMinor: 250_000 },
          { fundSlug: "tech-contributions", fundName: "Tech Fund", receivedMinor: 200_000, holdingMinor: 200_000 },
        ],
      },
    ],
    recipients: [{ id: "mom", name: "Mom", kind: "person" }],
    purchases: [],
    settlements: [
      { id: "s1", fundSlug: "christmas-2k26", fundName: "Christmas 2k26", paidMinor: 250_000, settledAt: SETTLED_AT, recipientId: "mom", recipientName: "Mom", handedOverAt: null, settledByName: "Albert", note: null },
    ],
  };
}

function stubApi(snap: ReturnType<typeof snapshot> = snapshot()) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/church/snapshot")) {
        return new Response(JSON.stringify(snap), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ settlement: {} }), { status: 201, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fmt = (minor: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(minor / 100);

describe("ChurchSettlementsPanel", () => {
  it("shows what Mom is holding, per fund, and the exact settle time", async () => {
    stubApi();
    renderUi(<ChurchSettlementsPanel familyId="fam" isPlatformAdmin={false} />, { withProviders: true });

    expect(await screen.findByText("Mom is holding")).toBeTruthy();
    expect(screen.getAllByText(fmt(450_000)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Mom gave it to church/ })).toBeTruthy();

    const exact = new Intl.DateTimeFormat(undefined, {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    }).format(new Date(SETTLED_AT * 1000));
    // Fund card ("Last settled …") and the History row both carry the full time.
    expect(screen.getAllByText(`Last settled ${exact}`)).toHaveLength(2);
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === `${exact} · by Albert`)).toBeTruthy();
  });

  it("prefills the live with-you amount and sends the chosen recipient", async () => {
    const calls = stubApi();
    renderUi(<ChurchSettlementsPanel familyId="fam" isPlatformAdmin={false} />, { withProviders: true });

    const amount = (await screen.findByPlaceholderText("2500")) as HTMLInputElement;
    expect(amount.value).toBe("500"); // Christmas has ₹500 with you

    fireEvent.change(screen.getByDisplayValue(/Christmas 2k26 ·/), { target: { value: "tech-contributions" } });
    expect(amount.value).toBe("1000");

    fireEvent.click(screen.getByRole("button", { name: "Save settlement" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/church/settle"))).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url.includes("/church/settle"))!.init!.body));
    expect(body).toMatchObject({ familyId: "fam", fundSlug: "tech-contributions", paidMinor: 100_000, recipientId: "mom" });
    expect(body.dueMinor).toBeUndefined();
  });

  it("prompts to assign legacy entries that have no recipient", async () => {
    const snap = snapshot();
    snap.holders.push({
      recipientId: null as unknown as string,
      name: "Recipient not set",
      receivedMinor: 100_000,
      handedOverMinor: 0,
      holdingMinor: 100_000,
      openCount: 1,
      lastSettledAt: SETTLED_AT,
      byFund: [],
    });
    snap.settlements.push({ ...snap.settlements[0], id: "old", recipientId: null as unknown as string, recipientName: null as unknown as string });
    stubApi(snap);
    renderUi(<ChurchSettlementsPanel familyId="fam" isPlatformAdmin={false} />, { withProviders: true });
    expect(await screen.findByText(`${fmt(100_000)} settled without a name`)).toBeTruthy();
    expect(screen.getByText(/who\? \(tap to set\)/)).toBeTruthy();
  });

  it("warns when the website shows less collected than you settled", async () => {
    const snap = snapshot();
    snap.funds[0] = { ...snap.funds[0], withYouMinor: 0, overSettledMinor: 20_000 };
    stubApi(snap);
    renderUi(<ChurchSettlementsPanel familyId="fam" isPlatformAdmin={false} />, { withProviders: true });
    expect(await screen.findByText(new RegExp(`settled ${fmt(20_000).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} more`))).toBeTruthy();
  });

  it("“Mom gave it to church” posts a handover for Mom", async () => {
    const calls = stubApi();
    renderUi(<ChurchSettlementsPanel familyId="fam" isPlatformAdmin={false} />, { withProviders: true });
    fireEvent.click(await screen.findByRole("button", { name: /Mom gave it to church/ }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`Confirm .* given to church`) }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/church/handover"))).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url.includes("/church/handover"))!.init!.body));
    expect(body).toMatchObject({ familyId: "fam", recipientId: "mom" });
  });

  it("refreshes live totals on a timer (website payments can land any time)", async () => {
    const calls = stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderUi(<ChurchSettlementsPanel familyId="fam" isPlatformAdmin={false} />, { withProviders: true });
      await screen.findByText("Mom is holding");
      const before = calls.filter((c) => c.url.includes("/church/snapshot")).length;
      await vi.advanceTimersByTimeAsync(61_000);
      await waitFor(() =>
        expect(calls.filter((c) => c.url.includes("/church/snapshot")).length).toBeGreaterThan(before),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
