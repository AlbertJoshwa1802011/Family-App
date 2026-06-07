import { Hono } from "hono";
import type { HonoEnv } from "../types";

export const notificationRoutes = new Hono<HonoEnv>();

// Phase 3: in-app notifications (polling) + reminder prefs.
notificationRoutes.get("/", (c) => c.json({ notifications: [] }));
notificationRoutes.post("/:id/read", (c) => c.json({ ok: true }));
