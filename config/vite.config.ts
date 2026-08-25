import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// ---------------------------------------------------------------------------
// Content-Security-Policy (defense in depth).
//
// The renderer never talks to the network directly — all HTTP (AI providers,
// marketplace, MCP) runs in the main process — so the page CSP can be strict.
// The build policy blocks inline scripts entirely; the dev policy keeps
// 'unsafe-inline' only because Vite's React refresh preamble is an inline
// script, and ws://localhost for HMR.
// ---------------------------------------------------------------------------
const CSP_BUILD =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
  + "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const CSP_DEV =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
  + "img-src 'self' data: blob:; font-src 'self' data:; "
  + "connect-src 'self' ws://localhost:* http://localhost:*; "
  + "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";

function cspPlugin(policy: string, apply: 'build' | 'serve'): Plugin {
  return {
    name: 'loom-csp',
    apply,
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    cspPlugin(CSP_DEV, 'serve'),
    cspPlugin(CSP_BUILD, 'build'),
  ],
  resolve: {
    // Exact-match alias only: subpath imports like
    // 'monaco-editor/min/vs/editor/editor.main.css' or
    // 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' must keep
    // resolving on their own.
    alias: [
      {
        find: /^monaco-editor$/,
        // monaco-editor's package.json has no main field (module only);
        // istanbul instrumentation can't resolve its entry, so point straight
        // at the ESM entry (equivalent to Vite's default resolution).
        replacement: path.resolve(__dirname, '../node_modules/monaco-editor/esm/vs/editor/editor.main.js'),
      },
      { find: '@', replacement: path.resolve(__dirname, '../src') },
    ],
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
    server: {
      deps: {
        // istanbul 插桩模式会跳过 optimizeDeps 预构建，需要把 monaco 内联
        // 打包才能解析其 ESM 入口（否则 coverage 模式报 resolve 错误）。
        inline: ['monaco-editor'],
      },
    },
    coverage: {
      // istanbul 可插桩 TSX（v8 不行），把渲染层组件纳入覆盖率门禁。
      // 阈值按 2026-08-14 实测校准（含大量未测试组件拉低均值），随里程碑上调。
      provider: 'istanbul',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/**', 'src/agent/**', 'src/shared/**', 'src/renderer/**'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/renderer/node_modules/**',
        // 渲染层入口与静态声明不参与覆盖率
        'src/renderer/main.tsx',
        'src/renderer/index.html',
        'src/shared/i18n/**',
      ],
      thresholds: {
        // 2026-08-25 实测：16.89/13.7/15.75/18.24（含新增组件测试与拆分模块）。
        // 阈值留安全余量防 CI 抖动；每里程碑随组件测试增加而上调。
        statements: 16,
        branches: 12,
        functions: 14,
        lines: 17,
      },
    },
  },
});
