import type { Next } from "hono";
import type { AppContext } from "../types";

interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in seconds (>= 60, KV TTL minimum). */
  windowSecs: number;
  /** Namespace so different buckets (auth vs. mutations) don't collide. */
  keyPrefix: string;
  /** When true, only count unsafe (state-changing) methods. */
  unsafeOnly?: boolean;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function clientIp(c: AppContext): string {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Coarse per-IP fixed-window rate limiter backed by KV.
 *
 * - No-ops when KV isn't bound (unit tests / minimal local dev) so it never
 *   changes behaviour there.
 * - Read-then-write isn't atomic in KV, so the cap is approximate — fine for
 *   abuse mitigation, not for billing-grade quotas.
 */
export function rateLimit(opts: RateLimitOptions) {
  return async (c: AppContext, next: Next) => {
    const kv = c.env?.KV;
    if (!kv) return next();
    if (opts.unsafeOnly && SAFE_METHODS.has(c.req.method)) return next();

    const ip = clientIp(c);
    const window = Math.floor(Date.now() / 1000 / opts.windowSecs);
    const key = `rl:${opts.keyPrefix}:${ip}:${window}`;

    const current = Number((await kv.get(key)) ?? "0");
    if (current >= opts.limit) {
      return c.json({ error: "rate_limited" }, 429);
    }
    // TTL a little past the window so the counter self-expires.
    await kv.put(key, String(current + 1), {
      expirationTtl: Math.max(opts.windowSecs + 5, 60),
    });
    return next();
  };
}
