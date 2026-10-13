import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:3021", changeOrigin: false },
      "^/callback/auth/google(?:\\?|$)": { target: "http://127.0.0.1:3021", changeOrigin: false },
    },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: { game: "index.html", characters: "characters.html" },
      output: {
        manualChunks: (id) => id.includes("node_modules/phaser") ? "phaser" : undefined,
      },
    },
  },
});
