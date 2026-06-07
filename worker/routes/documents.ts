import { Hono } from "hono";
import type { HonoEnv } from "../types";

export const documentRoutes = new Hono<HonoEnv>();

// Phase 2: metadata CRUD + Drive upload/download proxy.
documentRoutes.get("/", (c) => c.json({ documents: [] }));
documentRoutes.post("/", (c) => c.json({ error: "not_implemented", phase: 2 }, 501));
documentRoutes.get("/:id", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);
documentRoutes.post("/:id/files", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);
documentRoutes.get("/:id/files/:fid/download", (c) =>
  c.json({ error: "not_implemented", phase: 2 }, 501),
);
