import { Hono } from "hono";
import type { HonoEnv } from "../types";

export const familyRoutes = new Hono<HonoEnv>();

// Phase 1: create family (+ Drive folder), members, invites, accept.
familyRoutes.get("/", (c) => c.json({ families: [] }));
familyRoutes.post("/", (c) => c.json({ error: "not_implemented", phase: 1 }, 501));
familyRoutes.get("/:id/members", (c) => c.json({ members: [] }));
familyRoutes.post("/:id/invites", (c) =>
  c.json({ error: "not_implemented", phase: 1 }, 501),
);
