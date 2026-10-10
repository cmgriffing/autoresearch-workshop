import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.VISUALIZER_API_PORT ?? "4310"}`,
        changeOrigin: true,
      },
    },
  },
});
