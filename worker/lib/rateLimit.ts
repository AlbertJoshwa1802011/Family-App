import type { AppContext } from "../types";

/**
 * Fixed-window rate limiter backed by KV.
 *
 * KV is eventually consistent across edge locations, so this is a best-effort
 * throttle against brute force / abuse, not a hard quota — exactly the level
 * the architecture calls for on auth + upload endpoints. If the KV binding is
 * missing (unit tests without env) the limiter fails open.
 *
 * Returns a 429 Response when the caller is over the limit, otherwise null.
 */
export async function checkRateLimit(
  c: AppContext,
  bucket: string,
  opts: { limit: number; windowSecs: number },
): Promise<Response | null> {
  const kv = c.env?.KV;
  if (!kv) return null;

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % opts.windowSecs);
  const key = `rl:${bucket}:${windowStart}`;

  const current = parseInt((await kv.get(key)) ?? "0", 10);
  if (current >= opts.limit) {
    const retryAfter = windowStart + opts.windowSecs - now;
    return c.json(
      { error: "rate_limited", retryAfter },
      429,
      { "Retry-After": String(Math.max(retryAfter, 1)) },
    );
  }

  // Window key expires shortly after the window closes; +60s covers clock skew.
  await kv.put(key, String(current + 1), {
    expirationTtl: Math.max(opts.windowSecs + 60, 60),
  });

  return null;
}

/** Client identifier for per-IP limits: Cloudflare sets cf-connecting-ip. */
export function clientIp(c: AppContext): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}
