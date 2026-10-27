/**
 * Church fund ledger — where every rupee collected on the contributions site
 * currently sits.
 *
 *   website payment ──▶ with you ──settle──▶ with a recipient (Mom) ──hand over──▶ church
 *
 * - **With you**   = live collected − Σ paid out (per fund). Recomputed on every
 *   read so a payment made on the website a minute ago shows up immediately.
 *   It is never a stored snapshot (the old carry-forward `remainingMinor` froze
 *   the due at settle time and drifted — "settled ₹2,500, still shows ₹1,000").
 * - **With <recipient>** = Σ paid to them that they have not yet handed over.
 * - **Given to church** = Σ paid whose recipient has handed it over.
 *
 * Purchases on the contributions site are shown for context only; they are
 * the church spending money it already received, so they do not reduce what
 * you hold.
 */

export interface LedgerFund {
  slug: string;
  name: string;
  /** Live total collected, minor units (paise). */
  collectedMinor: number;
}

export interface LedgerSettlement {
  id: string;
  fundSlug: string;
  paidMinor: number;
  settledAt: number;
  recipientId: string | null;
  handedOverAt: number | null;
}

export interface LedgerRecipient {
  id: string;
  name: string;
  archivedAt: number | null;
}

export interface FundPosition {
  slug: string;
  collectedMinor: number;
  settledMinor: number;
  /** collected − settled, floored at 0. */
  withYouMinor: number;
  /** settled − collected when you paid out more than the site shows collected. */
  overSettledMinor: number;
  lastSettledAt: number | null;
}

export interface HolderFundPosition {
  fundSlug: string;
  fundName: string;
  receivedMinor: number;
  holdingMinor: number;
}

export interface HolderPosition {
  /** Destination id, or null for legacy rows that have no recipient yet. */
  recipientId: string | null;
  name: string;
  receivedMinor: number;
  handedOverMinor: number;
  /** Still in their hands — not yet given to church. */
  holdingMinor: number;
  openCount: number;
  lastSettledAt: number | null;
  byFund: HolderFundPosition[];
}

export interface LedgerTotals {
  collectedMinor: number;
  settledMinor: number;
  withYouMinor: number;
  withRecipientsMinor: number;
  givenToChurchMinor: number;
}

export interface ChurchLedger {
  funds: Map<string, FundPosition>;
  holders: HolderPosition[];
  totals: LedgerTotals;
}

export function computeChurchLedger(
  funds: LedgerFund[],
  settlements: LedgerSettlement[],
  recipients: LedgerRecipient[],
): ChurchLedger {
  const fundName = new Map(funds.map((f) => [f.slug, f.name]));
  const recipientName = new Map(recipients.map((r) => [r.id, r.name]));

  const settledBySlug = new Map<string, number>();
  const lastBySlug = new Map<string, number>();
  for (const s of settlements) {
    settledBySlug.set(s.fundSlug, (settledBySlug.get(s.fundSlug) ?? 0) + s.paidMinor);
    lastBySlug.set(s.fundSlug, Math.max(lastBySlug.get(s.fundSlug) ?? 0, s.settledAt));
  }

  const fundPositions = new Map<string, FundPosition>();
  for (const f of funds) {
    const settledMinor = settledBySlug.get(f.slug) ?? 0;
    const diff = f.collectedMinor - settledMinor;
    fundPositions.set(f.slug, {
      slug: f.slug,
      collectedMinor: f.collectedMinor,
      settledMinor,
      withYouMinor: Math.max(diff, 0),
      overSettledMinor: Math.max(-diff, 0),
      lastSettledAt: lastBySlug.get(f.slug) ?? null,
    });
  }

  // Holders: every active recipient (so Mom shows ₹0 rather than vanishing)
  // plus any archived one / the legacy "no recipient" bucket that has rows.
  const holderMap = new Map<string, HolderPosition & { fundMap: Map<string, HolderFundPosition> }>();
  const keyOf = (id: string | null) => id ?? "";
  const ensure = (id: string | null) => {
    const key = keyOf(id);
    let h = holderMap.get(key);
    if (!h) {
      h = {
        recipientId: id,
        name: id === null ? "Recipient not set" : (recipientName.get(id) ?? "Removed recipient"),
        receivedMinor: 0,
        handedOverMinor: 0,
        holdingMinor: 0,
        openCount: 0,
        lastSettledAt: null,
        byFund: [],
        fundMap: new Map(),
      };
      holderMap.set(key, h);
    }
    return h;
  };
  for (const r of recipients) if (r.archivedAt === null) ensure(r.id);

  for (const s of settlements) {
    const h = ensure(s.recipientId);
    h.receivedMinor += s.paidMinor;
    h.lastSettledAt = Math.max(h.lastSettledAt ?? 0, s.settledAt);
    let pf = h.fundMap.get(s.fundSlug);
    if (!pf) {
      pf = {
        fundSlug: s.fundSlug,
        fundName: fundName.get(s.fundSlug) ?? s.fundSlug,
        receivedMinor: 0,
        holdingMinor: 0,
      };
      h.fundMap.set(s.fundSlug, pf);
    }
    pf.receivedMinor += s.paidMinor;
    if (s.handedOverAt === null) {
      h.holdingMinor += s.paidMinor;
      h.openCount += 1;
      pf.holdingMinor += s.paidMinor;
    } else {
      h.handedOverMinor += s.paidMinor;
    }
  }

  const holders = [...holderMap.values()]
    .map(({ fundMap, ...h }) => ({
      ...h,
      byFund: [...fundMap.values()].sort((a, b) => b.holdingMinor - a.holdingMinor),
    }))
    // Real recipients first (most money held first); legacy bucket last.
    .sort((a, b) => {
      if ((a.recipientId === null) !== (b.recipientId === null)) {
        return a.recipientId === null ? 1 : -1;
      }
      return b.holdingMinor - a.holdingMinor || a.name.localeCompare(b.name);
    });

  let collectedMinor = 0;
  let withYouMinor = 0;
  for (const p of fundPositions.values()) {
    collectedMinor += p.collectedMinor;
    withYouMinor += p.withYouMinor;
  }
  let settledMinor = 0;
  let withRecipientsMinor = 0;
  let givenToChurchMinor = 0;
  for (const h of holders) {
    settledMinor += h.receivedMinor;
    withRecipientsMinor += h.holdingMinor;
    givenToChurchMinor += h.handedOverMinor;
  }

  return {
    funds: fundPositions,
    holders,
    totals: {
      collectedMinor,
      settledMinor,
      withYouMinor,
      withRecipientsMinor,
      givenToChurchMinor,
    },
  };
}
