import type { Context } from "hono";

/** Cloudflare bindings + secrets available to the Worker. */
export interface Env {
  /** Static assets (built SPA). Provided by @cloudflare/vite-plugin / wrangler assets. */
  ASSETS: Fetcher;
  /** D1 database (app metadata). */
  DB: D1Database;
  /** KV namespace (cached owner Drive access token, single-flight locks). */
  KV: KVNamespace;
  /**
   * R2 bucket for document file bytes (primary storage).
   * Optional so local/CI tests can run without a live bucket — upload routes
   * fall back to Google Drive, or return `storage_not_configured` when neither
   * R2 nor Drive is connected.
   */
  FILES?: R2Bucket;

  // ---- vars (wrangler.jsonc [vars]) ----
  APP_URL: string;

  // ---- secrets (wrangler secret put / .dev.vars) ----
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Long-lived refresh token for the owner's Google Drive account. */
  GOOGLE_OWNER_REFRESH_TOKEN?: string;
  /** Resend API key for transactional email. */
  RESEND_API_KEY?: string;
  /** Secret used to sign/derive session + invite token hashes. */
  SESSION_SECRET?: string;
  /** Comma-separated emails bootstrapped as platform admins on first login. */
  PLATFORM_ADMIN_EMAILS?: string;
  /** Google Gemini API key. Without it the assistant returns 501. */
  GEMINI_API_KEY?: string;
  /** Gemini model id. Overridable so the model can be changed without a deploy. */
  GEMINI_MODEL?: string;
  /** From-address for outbound mail. Must be on a domain verified with Resend. */
  EMAIL_FROM?: string;
  /**
   * Origin of the Light of Jesus church contributions app
   * (Cloudflare Pages). Worker fetches /api/funds and /api/purchases.
   */
  CONTRIBUTIONS_API_URL?: string;
  /** Machine token accepted by the contributions app as ADMIN_API_TOKEN. */
  CONTRIBUTIONS_API_TOKEN?: string;
}

/** Per-request variables set by middleware (e.g. the authenticated user). */
export interface Variables {
  userId?: string;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export type HonoEnv = { Bindings: Env; Variables: Variables };
