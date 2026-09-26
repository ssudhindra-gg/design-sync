// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },

    // SPA mode emits a static shell at build time instead of needing a Node
    // server at runtime, which is what lets the FastAPI backend serve the
    // frontend itself (see backend/app/static.py). Routing and rendering move
    // to the client. outputPath overrides the default "/_shell" so the shell
    // lands at the index.html the backend looks for.
    spa: {
      enabled: true,
      prerender: { outputPath: "/index.html" },
    },
  },
});
