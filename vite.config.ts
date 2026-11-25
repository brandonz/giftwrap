import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';

// GitHub Pages cannot set response headers, so the policy ships as a meta tag (build only:
// the dev server needs inline scripts and a websocket).
const csp: Plugin = {
  name: 'giftwrap-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      'img-src https: data: blob:',
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
    return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
};

export default defineConfig({
  base: './',
  plugins: [csp],
  build: {
    target: 'es2022',
    // three.js is most of the bundle (about 160 KB gzipped in all); one shared chunk is fine.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        wrap: resolve(import.meta.dirname, 'index.html'),
        open: resolve(import.meta.dirname, 'open/index.html'),
      },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
