import { defineConfig } from "vite";

export default defineConfig({
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
