/**
 * AI chat route contract tests (no live Gemini calls).
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import {
  createTestEnv,
  seedActor,
  seedFamily,
  seedUser,
} from "./helpers/testEnv";
import type { Env } from "../worker/types";

const ORIGIN = "http://localhost:5173";

function post(env: Env, path: string, cookie: string | null, body: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: ORIGIN,
  };
  if (cookie) headers.Cookie = cookie;
  return app.request(
    path,
    { method: "POST", headers, body: JSON.stringify(body) },
    env,
  );
}

describe("/api/ai/chat", () => {
  it("returns 401 without a session", async () => {
    const { env } = createTestEnv({ GEMINI_API_KEY: "fake-key" });
    const res = await post(env, "/api/ai/chat", null, {
      familyId: "f-1",
      message: "hi",
    });
    expect(res.status).toBe(401);
  });

  it("returns 503 without GEMINI_API_KEY", async () => {
    const { env, sqlite } = createTestEnv(); // no key
    const user = seedUser(sqlite);
    const family = seedFamily(sqlite, user.id);
    const actor = seedActor(sqlite, family.id, "member");

    const res = await post(env, "/api/ai/chat", actor.cookie, {
      familyId: family.id,
      message: "I spent 12 on coffee",
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ai_unavailable");
  });

  it("returns 400 on validation errors", async () => {
    const { env, sqlite } = createTestEnv({ GEMINI_API_KEY: "fake-key" });
    const user = seedUser(sqlite);
    const family = seedFamily(sqlite, user.id);
    const actor = seedActor(sqlite, family.id, "member");

    const res = await post(env, "/api/ai/chat", actor.cookie, {
      familyId: family.id,
      // message missing
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 404 for a non-member family", async () => {
    const { env, sqlite } = createTestEnv({ GEMINI_API_KEY: "fake-key" });
    const user = seedUser(sqlite);
    const family = seedFamily(sqlite, user.id);
    const other = seedFamily(sqlite, seedUser(sqlite).id, "Other");
    const actor = seedActor(sqlite, family.id, "member");

    const res = await post(env, "/api/ai/chat", actor.cookie, {
      familyId: other.id,
      message: "hello",
    });
    expect(res.status).toBe(404);
  });
});
