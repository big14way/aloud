/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.ts", "eval/**/*.test.ts"],
  },
});
