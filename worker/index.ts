import { Hono } from "hono";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./types";
import { authRoutes } from "./routes/auth";
import { familyRoutes } from "./routes/families";
import { documentRoutes } from "./routes/documents";
import { notificationRoutes } from "./routes/notifications";
import { eventRoutes } from "./routes/events";
import { taskRoutes } from "./routes/tasks";
import { contactRoutes } from "./routes/contacts";
import { activityRoutes } from "./routes/activity";
import { adminRoutes } from "./routes/admin";
import { vaultRoutes } from "./routes/vault";
import { itemsRoutes } from "./routes/items";
import { expenseRoutes } from "./routes/expenses";
import { financeRoutes } from "./routes/finance";
import { fundRoutes } from "./routes/funds";
import { wishlistRoutes } from "./routes/wishlist";
import { assistantRoutes } from "./routes/assistant";
import { calendarRoutes } from "./routes/calendar";
import { churchRoutes } from "./routes/church";
import { deviceLockRoutes } from "./routes/deviceLock";
import { runExpiryReminders, runLifeEventReminders } from "./cron";
import { runCommitmentReminders } from "./lib/finance/commitmentCron";
import { getDb } from "./db/client";
import { purgeExpiredSessions } from "./lib/session";

// 1 MiB cap on JSON request bodies. File uploads go to a dedicated multipart
// route with its own (larger) streaming limit; this protects every metadata
// endpoint from a memory-exhaustion DoS via a giant JSON payload.
const JSON_BODY_LIMIT = 1024 * 1024;
/** Multipart R2 upload path — must stay under the R2_MAX_BYTES soft cap (+ overhead). */
const R2_UPLOAD_BODY_LIMIT = 26 * 1024 * 1024;
const R2_UPLOAD_PATH = /^\/api\/documents\/[^/]+\/files\/upload$/;

const app = new Hono<HonoEnv>();

// Scope middleware to /api/* — static-asset/SPA responses are served by the ASSETS
// binding (with headers from public/_headers), not through this Worker pipeline.
app.use("/api/*", requestId());
app.use("/api/*", logger());
app.use("/api/*", secureHeaders());
// Reject oversized JSON bodies before any handler runs (memory-safety).
// Skip the multipart R2 upload route — it has its own larger limit below.
app.use("/api/*", async (c, next) => {
  if (c.req.method === "POST" && R2_UPLOAD_PATH.test(new URL(c.req.url).pathname)) {
    return next();
  }
  return bodyLimit({
    maxSize: JSON_BODY_LIMIT,
    onError: (ctx) => ctx.json({ error: "payload_too_large" }, 413),
  })(c, next);
});
app.use("/api/documents/:id/files/upload", bodyLimit({
  maxSize: R2_UPLOAD_BODY_LIMIT,
  onError: (c) => c.json({ error: "payload_too_large" }, 413),
}));

// --- API routes (everything else falls through to static assets) ---
const api = new Hono<HonoEnv>();

api.get("/health", (c) =>
  c.json({ ok: true, service: "family-vault", time: Date.now() }),
);

api.route("/auth", authRoutes);
api.route("/families", familyRoutes);
api.route("/documents", documentRoutes);
api.route("/notifications", notificationRoutes);
api.route("/events", eventRoutes);
api.route("/tasks", taskRoutes);
api.route("/contacts", contactRoutes);
api.route("/activity", activityRoutes);
api.route("/admin", adminRoutes);
api.route("/vault", vaultRoutes);
api.route("/items", itemsRoutes);
api.route("/expenses", expenseRoutes);
api.route("/finance", financeRoutes);
api.route("/funds", fundRoutes);
api.route("/wishlist", wishlistRoutes);
api.route("/assistant", assistantRoutes);
api.route("/calendar", calendarRoutes);
api.route("/church", churchRoutes);
api.route("/device-lock", deviceLockRoutes);

// Unknown API routes must return JSON 404 (NOT the SPA index.html).
api.all("*", (c) => c.json({ error: "not_found" }, 404));

app.route("/api", api);

// Consistent JSON error shape for API; never leak internals to the client.
app.onError((err, c) => {
  // requestId is set by the requestId() middleware on /api/*; correlate logs ↔ clients.
  const reqId = c.get("requestId");
  if (err instanceof HTTPException) {
    return c.json({ error: err.message || "error", requestId: reqId }, err.status);
  }
  // Log the full error server-side (with the request id) but return a generic message.
  console.error(`[${reqId ?? "no-id"}] Unhandled error:`, err);
  return c.json({ error: "internal_error", requestId: reqId }, 500);
});

// Exported for unit tests.
export { app };

export default {
  fetch: app.fetch,

  // Daily 09:00 Asia/Kolkata (`30 3 * * *` UTC in wrangler.jsonc).
  // Runs on Cloudflare whether or not anyone is logged in or has the PWA open.
  async scheduled(
    _event: ScheduledController,
    env: HonoEnv["Bindings"],
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(runExpiryReminders(env));
    ctx.waitUntil(runCommitmentReminders(env));
    ctx.waitUntil(runLifeEventReminders(env));
    ctx.waitUntil(purgeExpiredSessions(getDb(env)));
  },
} satisfies ExportedHandler<HonoEnv["Bindings"]>;
