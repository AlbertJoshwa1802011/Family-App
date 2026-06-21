import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

describe("/api/vault: contract and security", () => {
  const protectedRoutes = [
    { method: "POST",   path: "/api/vault/init?familyId=f-1" },
    { method: "GET",    path: "/api/vault/status?familyId=f-1" },
    { method: "GET",    path: "/api/vault/keys?familyId=f-1" },
    { method: "PUT",    path: "/api/vault/keys" },
    { method: "GET",    path: "/api/vault/member-keys?familyId=f-1&userId=u-1" },
    { method: "PUT",    path: "/api/vault/member-keys" },
    { method: "GET",    path: "/api/vault/items?familyId=f-1" },
    { method: "POST",   path: "/api/vault/items" },
    { method: "GET",    path: "/api/vault/items/item-1" },
    { method: "POST",   path: "/api/vault/items/item-1/reveal" },
    { method: "PATCH",  path: "/api/vault/items/item-1" },
    { method: "DELETE", path: "/api/vault/items/item-1" },
    { method: "POST",   path: "/api/vault/items/item-1/tags" },
    { method: "GET",    path: "/api/vault/search?familyId=f-1&tags=tag1" },
    { method: "POST",   path: "/api/vault/passkeys/register/start" },
    { method: "POST",   path: "/api/vault/passkeys/register/finish" },
    { method: "POST",   path: "/api/vault/passkeys/authenticate/start" },
    { method: "POST",   path: "/api/vault/passkeys/authenticate/finish" },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401 without session`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  }

  it("/api/vault/x/y/z → 404 JSON for unknown deep path", async () => {
    const res = await app.request("/api/vault/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});

describe("/api/items: contract and security", () => {
  const protectedRoutes = [
    { method: "GET",    path: "/api/items?familyId=f-1&type=subscription" },
    { method: "POST",   path: "/api/items" },
    { method: "GET",    path: "/api/items/item-1" },
    { method: "PATCH",  path: "/api/items/item-1" },
    { method: "DELETE", path: "/api/items/item-1" },
  ];

  for (const { method, path } of protectedRoutes) {
    it(`${method} ${path} → 401 without session`, async () => {
      const res = await app.request(path, { method });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("unauthorized");
    });
  }

  it("/api/items/x/y/z → 404 JSON for unknown deep path", async () => {
    const res = await app.request("/api/items/x/y/z");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
