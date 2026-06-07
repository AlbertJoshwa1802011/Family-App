/**
 * API tests for /api/events, /api/tasks, /api/contacts
 * Tests route registration, HTTP methods, response shapes, and Zod validation.
 */
import { describe, expect, it } from "vitest";
import { app } from "../worker/index";

describe("/api/events routes", () => {
  it("GET /api/events returns empty array shape", async () => {
    const res = await app.request("/api/events");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("POST /api/events with valid body returns 501 (not yet implemented)", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Christmas Dinner",
        startAt: Math.floor(Date.now() / 1000) + 86400,
        type: "gathering",
      }),
    });
    expect(res.status).toBe(501);
  });

  it("POST /api/events with missing title returns 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startAt: 1750000000 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("POST /api/events with empty title returns 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", startAt: 1750000000 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("POST /api/events with title exceeding 200 chars returns 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "a".repeat(201),
        startAt: 1750000000,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/events with non-numeric startAt returns 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Party", startAt: "not-a-number" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/events with endAt < startAt returns 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Party",
        startAt: 1750000000,
        endAt: 1749000000, // earlier than startAt
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("POST /api/events with endAt === startAt is valid (instant event)", async () => {
    const ts = Math.floor(Date.now() / 1000) + 3600;
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Quick call", startAt: ts, endAt: ts }),
    });
    // 501 means validation passed, route stub responded
    expect(res.status).toBe(501);
  });

  it("POST /api/events with invalid type enum returns 400", async () => {
    const res = await app.request("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Event",
        startAt: 1750000000,
        type: "birthday", // not in enum
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/events/:id returns 501", async () => {
    const res = await app.request("/api/events/some-id");
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_implemented");
  });

  it("PATCH /api/events/:id with invalid body returns 400", async () => {
    const res = await app.request("/api/events/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }), // empty title fails min(1)
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/events/:id with valid partial body returns 501", async () => {
    const res = await app.request("/api/events/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location: "City Hall" }),
    });
    expect(res.status).toBe(501);
  });

  it("DELETE /api/events/:id returns 501", async () => {
    const res = await app.request("/api/events/some-id", { method: "DELETE" });
    expect(res.status).toBe(501);
  });

  it("POST /api/events/:id/cancel returns 501", async () => {
    const res = await app.request("/api/events/some-id/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(501);
  });

  it("POST /api/events/:id/attendees with empty memberIds returns 400", async () => {
    const res = await app.request("/api/events/some-id/attendees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: [] }), // min(1) violation
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/events/:id/attendees with valid memberIds returns 501", async () => {
    const res = await app.request("/api/events/some-id/attendees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberIds: ["member-1", "member-2"] }),
    });
    expect(res.status).toBe(501);
  });

  it("DELETE /api/events/:id/attendees/:memberId returns 501", async () => {
    const res = await app.request(
      "/api/events/event-1/attendees/member-1",
      { method: "DELETE" },
    );
    expect(res.status).toBe(501);
  });

  it("returns JSON content-type on all event responses", async () => {
    const res = await app.request("/api/events");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("/api/tasks routes", () => {
  it("GET /api/tasks returns empty array shape", async () => {
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: unknown[] };
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it("POST /api/tasks with valid body returns 501", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renew passport" }),
    });
    expect(res.status).toBe(501);
  });

  it("POST /api/tasks with missing title returns 400", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "something" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("POST /api/tasks with empty title returns 400", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks with invalid dueDate format returns 400", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Task", dueDate: "14/06/2026" }), // wrong format
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/tasks with valid ISO dueDate returns 501", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Task", dueDate: "2026-06-14" }),
    });
    expect(res.status).toBe(501);
  });

  it("GET /api/tasks/:id returns 501", async () => {
    const res = await app.request("/api/tasks/some-id");
    expect(res.status).toBe(501);
  });

  it("PATCH /api/tasks/:id with invalid status returns 400", async () => {
    const res = await app.request("/api/tasks/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }), // not in enum
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/tasks/:id with valid status returns 501", async () => {
    const res = await app.request("/api/tasks/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.status).toBe(501);
  });

  it("DELETE /api/tasks/:id returns 501", async () => {
    const res = await app.request("/api/tasks/some-id", { method: "DELETE" });
    expect(res.status).toBe(501);
  });
});

describe("/api/contacts routes", () => {
  it("GET /api/contacts returns empty array shape", async () => {
    const res = await app.request("/api/contacts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { contacts: unknown[] };
    expect(Array.isArray(body.contacts)).toBe(true);
  });

  it("POST /api/contacts with valid body returns 501", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Dr. Smith",
        relationship: "Doctor",
        phone: "+1 555 0100",
      }),
    });
    expect(res.status).toBe(501);
  });

  it("POST /api/contacts with missing name returns 400", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1 555 0100" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("POST /api/contacts with invalid phone characters returns 400", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Contact", phone: "abc-def-ghij" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/contacts with valid phone formats passes", async () => {
    const validPhones = ["+44 20 7946 0958", "(555) 012-3456", "+91-9876543210"];
    for (const phone of validPhones) {
      const res = await app.request("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Contact", phone }),
      });
      expect(res.status, `phone "${phone}" should pass validation`).toBe(501);
    }
  });

  it("POST /api/contacts with invalid email returns 400", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Contact", email: "not-an-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/contacts with empty email (optional) passes", async () => {
    const res = await app.request("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Contact", email: "" }),
    });
    expect(res.status).toBe(501);
  });

  it("GET /api/contacts/:id returns 501", async () => {
    const res = await app.request("/api/contacts/some-id");
    expect(res.status).toBe(501);
  });

  it("PATCH /api/contacts/:id with valid body returns 501", async () => {
    const res = await app.request("/api/contacts/some-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Updated notes" }),
    });
    expect(res.status).toBe(501);
  });

  it("DELETE /api/contacts/:id returns 501", async () => {
    const res = await app.request("/api/contacts/some-id", { method: "DELETE" });
    expect(res.status).toBe(501);
  });
});

describe("Route registration — unknown sub-paths still return JSON 404", () => {
  it("/api/events/bad/deeply/nested returns JSON 404", async () => {
    const res = await app.request("/api/events/a/b/c/d");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/tasks/unknown/deep returns JSON 404", async () => {
    const res = await app.request("/api/tasks/a/b/c");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("/api/contacts/unknown/deep returns JSON 404", async () => {
    const res = await app.request("/api/contacts/a/b/c");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });
});
