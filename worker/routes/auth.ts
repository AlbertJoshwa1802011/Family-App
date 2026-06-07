import { Hono } from "hono";
import type { HonoEnv } from "../types";

export const authRoutes = new Hono<HonoEnv>();

// Phase 1 will implement Google OAuth (Auth Code + PKCE) + sessions.
authRoutes.get("/me", (c) => c.json({ user: null, families: [] }));

authRoutes.post("/google/start", (c) =>
  c.json({ error: "not_implemented", phase: 1 }, 501),
);

authRoutes.get("/google/callback", (c) =>
  c.json({ error: "not_implemented", phase: 1 }, 501),
);

authRoutes.post("/logout", (c) => c.json({ ok: true }));
