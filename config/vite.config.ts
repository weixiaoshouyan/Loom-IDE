import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../src'),
    },
  },
  root: path.resolve(__dirname, '../src/renderer'),
  publicDir: path.resolve(__dirname, '../public'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../dist/renderer'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/xterm')) return 'vendor-xterm';
          if (id.includes('node_modules/monaco-editor')) return 'monaco-editor';
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
  server: { port: 5174 },
  worker: { format: 'es' },
  optimizeDeps: { include: ['monaco-editor'] },
  test: {
    globals: true,
    // Default env is 'node' (covers main/agent/shared tests).
    // Renderer component tests that mount React should add the docblock:
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/**', 'src/agent/**', 'src/shared/**', 'src/renderer/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/renderer/node_modules/**',
      ],
      // Conservative floor to keep CI green on day one. Calibrate after the
      // first coverage run, then ratchet up ~10pp per milestone:
      //   e.g. 40 → 50 → 60 … until the team agrees on a target.
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 40,
        lines: 40,
      },
    },
  },
});
