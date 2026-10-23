/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Aloud",
        short_name: "Aloud",
        description: "One press, and it tells you what is in front of you, and when it is not sure.",
        theme_color: "#0d1013",
        background_color: "#0d1013",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,json}"],
        // Sample photos are for laptop judging; phones fetch them only if opened.
        globIgnores: ["samples/**"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/samples/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "samples", expiration: { maxEntries: 60 } },
          },
          {
            // The offline reader (Tesseract.js worker, core and English data) is fetched once, then kept.
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js|tesseract\.js-core|@tesseract\.js-data)/,
            handler: "CacheFirst",
            options: {
              cacheName: "offline-reader",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  test: {
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.ts", "eval/**/*.test.ts"],
  },
});
