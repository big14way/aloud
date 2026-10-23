import { createApp } from "../server/app.js";

// Vercel function entry. vercel.json rewrites /api/* here; Hono routes by the original path.
export default createApp();
