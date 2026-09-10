import type { Context } from "hono";

/** Cloudflare bindings + secrets available to the Worker. */
export interface Env {
  /** Static assets (built SPA). Provided by @cloudflare/vite-plugin / wrangler assets. */
  ASSETS: Fetcher;
  /** D1 database (app metadata). */
  DB: D1Database;
  /** KV namespace (cached owner Drive access token, single-flight locks). */
  KV: KVNamespace;

  // ---- vars (wrangler.jsonc [vars]) ----
  APP_URL: string;

  // ---- secrets (wrangler secret put / .dev.vars) ----
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Long-lived refresh token for the owner's Google Drive account. */
  GOOGLE_OWNER_REFRESH_TOKEN?: string;
  /** Resend API key for transactional email. */
  RESEND_API_KEY?: string;
  /** Claude API key for AI document categorization + assistant fallback (optional). */
  ANTHROPIC_API_KEY?: string;
  /** Gemini API key for the in-app family assistant (preferred when set). */
  GEMINI_API_KEY?: string;
  /** Optional Gemini model id override (falls through flash ids on 404). */
  GEMINI_MODEL?: string;
  /** Secret used to sign/derive session + invite token hashes. */
  SESSION_SECRET?: string;
  /**
   * Comma-separated emails that always receive app access + the `super_admin`
   * role on login (bootstrap for the first platform operator).
   */
  SUPER_ADMIN_EMAILS?: string;
  /** Inbox for new demo-request notifications (defaults to first SUPER_ADMIN_EMAILS). */
  ACCESS_NOTIFY_EMAIL?: string;
  /** Optional church contributions app origin (Funds → Church tab). */
  CONTRIBUTIONS_API_URL?: string;
  /** Optional machine token for the contributions app admin API. */
  CONTRIBUTIONS_API_TOKEN?: string;
}

/** Per-request variables set by middleware (e.g. the authenticated user). */
export interface Variables {
  userId?: string;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export type HonoEnv = { Bindings: Env; Variables: Variables };
