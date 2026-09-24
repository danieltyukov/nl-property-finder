/*
 * Vite config for the dashboard. The build lands in dist/, which the daemon
 * serves at / with the API token injected into index.html.
 *
 * `npm run dev -w @nlpf/dashboard` proxies /api and /calendar.ics to the mock
 * server (npm run mock -w @nlpf/dashboard, port 7432 unless NLPF_MOCK_PORT is
 * set) and injects the mock's token, so the dev page behaves like the real
 * one. Point NLPF_API at a running daemon and set NLPF_TOKEN to use that
 * instead.
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.NLPF_API ?? `http://127.0.0.1:${process.env.NLPF_MOCK_PORT ?? '7432'}`;
const token = process.env.NLPF_TOKEN ?? 'mock-token';

function devToken(): Plugin {
  return {
    name: 'nlpf-dev-token',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace('</head>', `<script>window.__NLPF__ = ${JSON.stringify({ token })};</script></head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), devToken()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/calendar.ics': { target, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
});
