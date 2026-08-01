/**
 * Pure expense-module libraries: merchant normalization and the (deliberately
 * not-yet-implemented) transaction ingestion contract.
 */
import { describe, expect, it } from "vitest";
import { displayMerchant, merchantKey } from "../worker/lib/expenses/merchant";
import {
  EXPENSE_SOURCES,
  TRANSACTION_KINDS,
  TRANSACTION_KIND_TREATMENT,
  countsAsSpending,
  createsExpenseRow,
} from "../worker/lib/expenses/types";
import {
  dedupeKey,
  fuzzyDedupeKey,
  normalizeMerchantFromDescription,
  type NormalizedTransaction,
} from "../worker/lib/expenses/ingest";

describe("merchantKey", () => {
  it("normalises case, padding and punctuation", () => {
    expect(merchantKey("  KFC  ")).toBe("kfc");
    expect(merchantKey("AMZN Mktp*IN")).toBe("amzn mktp in");
    expect(merchantKey("Swiggy-Instamart")).toBe("swiggy instamart");
  });

  it("groups accented spellings together", () => {
    expect(merchantKey("Café Noir")).toBe(merchantKey("Cafe Noir"));
  });

  it("gives the same key for the same merchant typed differently", () => {
    expect(merchantKey("kfc")).toBe(merchantKey("KFC "));
  });

  it("keeps genuinely different merchants apart", () => {
    expect(merchantKey("Amazon")).not.toBe(merchantKey("Amazon Fresh"));
  });

  it("returns null when nothing meaningful remains", () => {
    expect(merchantKey("")).toBeNull();
    expect(merchantKey("   ")).toBeNull();
    expect(merchantKey("***")).toBeNull();
    expect(merchantKey(null)).toBeNull();
    expect(merchantKey(undefined)).toBeNull();
  });

  it("caps the key length", () => {
    expect(merchantKey("a".repeat(500))!.length).toBeLessThanOrEqual(120);
  });
});

describe("displayMerchant", () => {
  it("collapses whitespace but preserves what the user typed", () => {
    expect(displayMerchant("  KFC   Whitefield ")).toBe("KFC Whitefield");
  });

  it("returns null for empty input", () => {
    expect(displayMerchant("   ")).toBeNull();
    expect(displayMerchant(null)).toBeNull();
  });
});

describe("transaction kind contract", () => {
  it("covers every kind a bank feed can produce", () => {
    expect(TRANSACTION_KINDS).toEqual([
      "expense",
      "income",
      "transfer",
      "refund",
      "reversal",
      "fee",
      "unknown",
    ]);
  });

  it("assigns a ledger treatment to every kind", () => {
    for (const kind of TRANSACTION_KINDS) {
      expect(TRANSACTION_KIND_TREATMENT[kind]).toBeDefined();
    }
  });

  it("never counts a transfer as spending", () => {
    // "HDFC → SBI ₹20,000" moves money; it does not spend it. Same for a
    // credit-card bill payment, whose purchases were already imported.
    expect(countsAsSpending("transfer")).toBe(false);
    expect(createsExpenseRow("transfer")).toBe(false);
  });

  it("never counts income as spending", () => {
    expect(countsAsSpending("income")).toBe(false);
    expect(createsExpenseRow("income")).toBe(false);
  });

  it("creates expense rows for purchases and fees only", () => {
    expect(createsExpenseRow("expense")).toBe(true);
    expect(createsExpenseRow("fee")).toBe(true);

    for (const kind of ["income", "transfer", "refund", "reversal", "unknown"] as const) {
      expect(createsExpenseRow(kind)).toBe(false);
    }
  });

  it("treats refunds and reversals as adjustments, not negative expenses", () => {
    expect(TRANSACTION_KIND_TREATMENT.refund).toBe("adjusts_expense");
    expect(TRANSACTION_KIND_TREATMENT.reversal).toBe("adjusts_expense");
    // They affect net spending without ever creating a row of their own.
    expect(countsAsSpending("refund")).toBe(true);
    expect(createsExpenseRow("refund")).toBe(false);
  });

  it("routes unclassifiable transactions to review, never to analytics", () => {
    expect(TRANSACTION_KIND_TREATMENT.unknown).toBe("needs_review");
    expect(countsAsSpending("unknown")).toBe(false);
  });

  it("lists every provenance the schema allows", () => {
    expect(EXPENSE_SOURCES).toContain("manual");
    expect(EXPENSE_SOURCES).toContain("bank_sync");
    expect(EXPENSE_SOURCES).toContain("csv_import");
  });
});

describe("dedupe keys", () => {
  it("scopes the primary key by family and source", () => {
    expect(dedupeKey("fam1", "bank_sync", "TXN-1")).toBe("fam1:bank_sync:TXN-1");
    expect(dedupeKey("fam1", "bank_sync", "TXN-1")).not.toBe(
      dedupeKey("fam2", "bank_sync", "TXN-1"),
    );
    expect(dedupeKey("fam1", "bank_sync", "TXN-1")).not.toBe(
      dedupeKey("fam1", "csv_import", "TXN-1"),
    );
  });

  const tx: NormalizedTransaction = {
    kind: "expense",
    externalId: null,
    externalAccount: "HDFC-4321",
    amountMinor: 12000,
    currency: "INR",
    spentOn: "2026-08-01",
    merchant: "Third Wave Coffee",
    merchantKey: "third wave coffee",
    source: "bank_sync",
  };

  it("matches identical same-day transactions on the fuzzy key", () => {
    expect(fuzzyDedupeKey(tx)).toBe(fuzzyDedupeKey({ ...tx }));
  });

  it("separates different amounts, days, accounts and merchants", () => {
    expect(fuzzyDedupeKey({ ...tx, amountMinor: 12001 })).not.toBe(fuzzyDedupeKey(tx));
    expect(fuzzyDedupeKey({ ...tx, spentOn: "2026-08-02" })).not.toBe(fuzzyDedupeKey(tx));
    expect(fuzzyDedupeKey({ ...tx, externalAccount: "SBI-9999" })).not.toBe(
      fuzzyDedupeKey(tx),
    );
    expect(fuzzyDedupeKey({ ...tx, merchantKey: "kfc" })).not.toBe(fuzzyDedupeKey(tx));
  });

  it("separates currencies so a ₹120 and a $120 charge never collide", () => {
    expect(fuzzyDedupeKey({ ...tx, currency: "USD" })).not.toBe(fuzzyDedupeKey(tx));
  });

  it("derives a merchant key from a raw bank narration", () => {
    expect(normalizeMerchantFromDescription("UPI/AMZN Mktp*IN/12345")).toBe(
      "upi amzn mktp in 12345",
    );
  });
});
