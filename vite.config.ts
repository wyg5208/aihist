import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

// FastAPI listens on 127.0.0.1:8000, exactly as Nginx will point at it in
// production. Keeping the same path prefix means no dev-only rewrite rules.
const proxy = { "/api": "http://127.0.0.1:8000" };

/**
 * Production Nginx maps /admin/ to admin.html. Vite has no such rule, so the
 * same two paths are rewritten here; otherwise the console link 404s in dev.
 */
function adminAlias(): Plugin {
  return {
    name: "aihist-admin-alias",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/admin" || req.url === "/admin/") {
          req.url = "/admin.html";
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/admin" || req.url === "/admin/") {
          req.url = "/admin.html";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), adminAlias()],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  build: {
    outDir: "dist",
    // The console is a second entry, not a route of the main app: it must be
    // reachable as /admin/ without react-router.
    rollupOptions: { input: { main: "index.html", admin: "admin.html" } },
  },
});
