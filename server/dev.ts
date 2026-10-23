import { serve } from "@hono/node-server";

// Local API for `npm run dev:api`. Vite proxies /api to this port.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: the API still starts and /api/health reports what is missing.
}

const { createApp } = await import("./app.js");
const port = Number(process.env.PORT) || 8787;
serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`Aloud API on http://localhost:${info.port}/api/health`);
});
