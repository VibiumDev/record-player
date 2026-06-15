import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/packages/player-element/register.ts"),
      formats: ["es"],
      fileName: () => "vibium-record-player.js",
    },
    outDir: "dist-element",
    emptyOutDir: true,
  },
});
