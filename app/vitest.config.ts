import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@vision': path.resolve(root, '../vision'),
      '@mediapipe/tasks-vision': path.resolve(root, 'node_modules/@mediapipe/tasks-vision'),
    },
  },
  test: {
    include: ['../vision/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
  },
});
