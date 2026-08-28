#!/usr/bin/env node
/**
 * E-1 foundation probe: prove (or refute) D1/workerd `DB.batch()` atomicity.
 *
 * Uses Miniflare's local workerd D1 binding — the same engine `wrangler d1
 * --local` / `vite` Cloudflare plugin use. Does NOT use the project's
 * `tests/helpers/testEnv.ts` node:sqlite adapter (whose `batch()` is a
 * sequential loop and is deliberately non-atomic).
 *
 * Expected property:
 *   successful INSERT + successful INSERT + failing INSERT
 *   → batch throws AND earlier rows are rolled back (no partial writes).
 *
 * Remote Cloudflare-hosted D1 is NOT exercised here (requires
 * CLOUDFLARE_API_TOKEN + a real database_id). Re-run with account credentials
 * against --remote workerd if/when that environment is available.
 *
 * Usage: node scripts/verify_d1_batch_atomicity.mjs
 * Exit 0 = atomicity proven locally; exit 2 = not proven / partial writes.
 */
import { Miniflare } from "miniflare";

const mf = new Miniflare({
  modules: true,
  script: `export default { async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/setup") {
      await env.DB.exec(
        "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)",
      );
      await env.DB.prepare("DELETE FROM t").run();
      return new Response("ok");
    }
    if (url.pathname === "/probe") {
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO t (id, v) VALUES (1, 'a')"),
          env.DB.prepare("INSERT INTO t (id, v) VALUES (2, 'b')"),
          env.DB.prepare("INSERT INTO t (id, v) VALUES (3, NULL)"),
        ]);
        return Response.json({ batchThrew: false, remainingRows: null });
      } catch (e) {
        const rows = await env.DB.prepare(
          "SELECT id, v FROM t ORDER BY id",
        ).all();
        return Response.json({
          batchThrew: true,
          error: String(e?.message || e),
          remainingRows: rows.results,
        });
      }
    }
    return new Response("not_found", { status: 404 });
  }}`,
  d1Databases: ["DB"],
});

try {
  const setup = await mf.dispatchFetch("http://localhost/setup");
  if (!setup.ok) {
    console.error("setup failed", setup.status, await setup.text());
    process.exit(2);
  }

  const probe = await mf.dispatchFetch("http://localhost/probe");
  const body = await probe.json();
  console.log(JSON.stringify({ environment: "miniflare/workerd local D1", ...body }, null, 2));

  if (
    body.batchThrew &&
    Array.isArray(body.remainingRows) &&
    body.remainingRows.length === 0
  ) {
    console.log(
      "VERDICT: ATOMIC — no partial earlier writes remained after the failing statement.",
    );
    process.exit(0);
  }

  console.log("VERDICT: NOT PROVEN / NON-ATOMIC under this probe.");
  process.exit(2);
} finally {
  await mf.dispose();
}
