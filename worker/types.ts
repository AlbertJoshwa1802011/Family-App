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
  /** Secret used to sign/derive session + invite token hashes. */
  SESSION_SECRET?: string;
  /** Optional OCR/text-extraction provider endpoint (POST file bytes → {text}). */
  OCR_PROVIDER_URL?: string;
  /** Optional bearer token for the OCR provider. */
  OCR_API_KEY?: string;
}

/** Per-request variables set by middleware (e.g. the authenticated user). */
export interface Variables {
  userId?: string;
}

export type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

export type HonoEnv = { Bindings: Env; Variables: Variables };
