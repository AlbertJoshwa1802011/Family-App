/**
 * Service-to-service client for the Light of Jesus church contributions app.
 *
 * Both apps are Cloudflare-hosted. Worker `fetch()` to the Pages origin is a
 * normal HTTPS call — no CORS, no browser cookies. Auth is the contributions
 * app's ADMIN_API_TOKEN (machine token with wildcard permissions).
 */
import type { Env } from "../types";

export const DEFAULT_CONTRIBUTIONS_URL =
  "https://light-of-jesus-ministry-contributions.pages.dev";

export function contributionsConfigured(env: Env): boolean {
  return Boolean(env.CONTRIBUTIONS_API_TOKEN);
}

function origin(env: Env): string {
  return (env.CONTRIBUTIONS_API_URL ?? DEFAULT_CONTRIBUTIONS_URL).replace(/\/$/, "");
}

export interface ChurchFund {
  slug: string;
  name: string;
  goalAmount: number;
  totalCollected: number;
  spentOnProducts: number;
  availableBalance: number;
  status: string;
}

export interface ChurchPurchase {
  id: string;
  name: string;
  amount: number;
  date: string;
  fund: string;
  status: string;
  vendor?: string | null;
  description?: string | null;
}

async function churchGet(
  env: Env,
  path: string,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; error: string }> {
  const token = env.CONTRIBUTIONS_API_TOKEN;
  if (!token) return { ok: false, status: 503, error: "church_not_configured" };
  try {
    const res = await fetch(`${origin(env)}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: "church_upstream_error" };
    }
    return { ok: true, json: JSON.parse(text) as unknown };
  } catch (err) {
    console.error("[church] fetch failed:", err);
    return { ok: false, status: 502, error: "church_unreachable" };
  }
}

function rupeesToMinor(n: number): number {
  return Math.round(Number(n || 0) * 100);
}

export async function fetchChurchFunds(
  env: Env,
): Promise<
  | { ok: true; funds: ChurchFund[]; currency: "INR" }
  | { ok: false; status: number; error: string }
> {
  const res = await churchGet(env, "/api/funds");
  if (!res.ok) return res;
  const body = res.json as { funds?: Array<Record<string, unknown>> };
  const funds: ChurchFund[] = (body.funds ?? []).map((f) => {
    const collected = Number(f.totalCollected ?? 0);
    const spent = Number(f.spentOnProducts ?? 0);
    return {
      slug: String(f.slug ?? ""),
      name: String(f.name ?? f.slug ?? "Fund"),
      goalAmount: Number(f.goalAmount ?? 0),
      totalCollected: collected,
      spentOnProducts: spent,
      availableBalance: Number(f.availableBalance ?? Math.max(collected - spent, 0)),
      status: String(f.status ?? "active"),
    };
  });
  return { ok: true, funds, currency: "INR" };
}

export async function fetchChurchPurchases(
  env: Env,
  fundSlug?: string,
): Promise<
  | { ok: true; purchases: ChurchPurchase[] }
  | { ok: false; status: number; error: string }
> {
  const path = fundSlug
    ? `/api/purchases?fund=${encodeURIComponent(fundSlug)}`
    : "/api/purchases";
  const res = await churchGet(env, path);
  if (!res.ok) return res;
  const body = res.json as {
    purchases?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
  };
  const rows = body.purchases ?? body.results ?? [];
  const purchases: ChurchPurchase[] = rows.map((p) => ({
    id: String(p.id ?? ""),
    name: String(p.name ?? p.productName ?? "Purchase"),
    amount: Number(p.amount ?? p.cost ?? 0),
    date: String(p.date ?? p.purchaseDate ?? ""),
    fund: String(p.fund ?? fundSlug ?? ""),
    status: String(p.status ?? "Active"),
    vendor: (p.vendor ?? p.vendorLink ?? null) as string | null,
    description: (p.description ?? null) as string | null,
  }));
  return { ok: true, purchases };
}

export { rupeesToMinor };
