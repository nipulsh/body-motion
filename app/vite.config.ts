import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin, ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_MODELS_DIR = path.resolve(__dirname, "raw_models");

const MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".glb": "model/gltf-binary",
};

function serveRawModels(): Plugin {
  return {
    name: "serve-raw-models",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/raw_models", (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const filePath = path.normalize(path.join(RAW_MODELS_DIR, rel));

        if (!filePath.startsWith(RAW_MODELS_DIR)) {
          next();
          return;
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: `Missing model file: ${rel}` }));
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const stat = fs.statSync(filePath);
        res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
        res.setHeader("Content-Length", String(stat.size));
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(RAW_MODELS_DIR)) return;

      const outDir = path.resolve(__dirname, "dist/raw_models");
      fs.mkdirSync(outDir, { recursive: true });

      for (const name of fs.readdirSync(RAW_MODELS_DIR)) {
        const src = path.join(RAW_MODELS_DIR, name);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, path.join(outDir, name));
        }
      }
    },
  };
}

const hmrHost = process.env.VITE_DEV_HOST;

export default defineConfig(() => ({
  base: "./",
  plugins: [react(), tailwindcss(), serveRawModels()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@vision": path.resolve(__dirname, "../vision"),
      "@mediapipe/tasks-vision": path.resolve(
        __dirname,
        "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs",
      ),
      // Imported from ../vision, which has no node_modules of its own.
      "onnxruntime-web/webgpu": path.resolve(
        __dirname,
        "node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs",
      ),
    },
  },
  optimizeDeps: {
    include: ["@mediapipe/tasks-vision"],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    host: hmrHost || false,
    hmr: hmrHost
      ? {
          protocol: "ws",
          host: hmrHost,
          port: 1421,
        }
      : undefined,
  },
  test: {
    include: ["../vision/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
}));
