import { defineConfig } from "drizzle-kit";

// Drizzle schema is the source of truth. `npm run db:generate` writes SQL migrations
// into ./migrations, which `wrangler d1 migrations apply` then runs against D1.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
});
