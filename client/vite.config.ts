import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only replacement for nginx SSI: index.html's <!--# include virtual="/api/settings/head-fragment" -->
 * is replaced at serve time with the build-time default head fragment (public/head-fragment-default.html).
 * Production serves it through nginx SSI against the live API; dev has no SSI processor.
 */
function devHeadFragmentPlugin(): Plugin {
  return {
    name: 'dev-head-fragment',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const fragment = readFileSync(join(__dirname, 'public/head-fragment-default.html'), 'utf8');
        return html.replace(/<!--# include virtual="\/api\/settings\/head-fragment" -->/, fragment.trim());
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devHeadFragmentPlugin()],
  assetsInclude: ['**/*.wasm'],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalizedId = id.replace(/\\/g, '/');

          if (normalizedId.includes('/node_modules/framer-motion/')) {
            return 'framer-motion';
          }

          if (normalizedId.includes('/src/components/shared/UploadModal.tsx')) {
            return 'upload-modal';
          }
          if (normalizedId.includes('/src/components/shared/NotificationPanel.tsx')) {
            return 'notification-panel';
          }
          if (normalizedId.includes('/src/components/shared/MobileNavDrawer.tsx')) {
            return 'mobile-nav-drawer';
          }

          // 87KB of legal text — only used by LegalPage + SettingsPage. Pin to its
          // own chunk so it never lands on the home first paint (saves ~28KB gzip
          // off the homepage's initial download).
          if (normalizedId.includes('/src/lib/legalContent.ts')) {
            return 'legal-content';
          }

          if (normalizedId.includes('/node_modules/')) {
            if (
              normalizedId.includes('/three/') ||
              normalizedId.includes('/three-stdlib/') ||
              normalizedId.includes('/@react-three/') ||
              normalizedId.includes('/@pmndrs/')
            ) {
              return 'viewer-3d';
            }
            if (
              normalizedId.includes('/xlsx/') ||
              normalizedId.includes('/@sentry/') ||
              normalizedId.includes('/read-excel-file/') ||
              normalizedId.includes('/write-excel-file/')
            ) {
              return;
            }

            if (normalizedId.includes('/lucide-react/')) {
              return 'vendor-lucide';
            }
            if (normalizedId.includes('/@tanstack/react-virtual/')) {
              return 'vendor-virtual';
            }

            return 'vendor-app';
          }

          if (normalizedId.includes('/src/api/') || normalizedId.includes('/src/stores/')) {
            return 'app-api';
          }

          if (
            normalizedId.includes('/src/components/shared/') ||
            normalizedId.includes('/src/hooks/') ||
            normalizedId.includes('/src/lib/')
          ) {
            return 'app-shared';
          }
        },
      },
    },
    // The 3D viewer intentionally keeps three.js in a lazy route chunk.
    // It is large by nature, but no longer affects the initial app bundle.
    chunkSizeWarningLimit: 1200,
  },
  optimizeDeps: {
    exclude: ['occt-import-js'],
  },
  server: {
    proxy: {
      '/api': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/static': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: devProxyTarget,
        changeOrigin: true,
      },
      // PWA manifest 由 API 按后台设置动态生成（nginx 同样把 /site.webmanifest 代理到 API）
      '/site.webmanifest': {
        target: devProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/site\.webmanifest$/, '/api/settings/site-manifest'),
      },
    },
  },
});
