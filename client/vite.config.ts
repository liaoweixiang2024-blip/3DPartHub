import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HEAD_FRAGMENT_SSI = '<!--# include virtual="/api/settings/head-fragment" -->';
const HEAD_FRAGMENT_PLACEHOLDER = '/api/settings/head-fragment';

/**
 * Dev-only replacement for nginx SSI: index.html's <!--# include virtual="/api/settings/head-fragment" -->
 * is replaced at serve time with a live fragment fetched from the dev API, so the first paint
 * (before any client JS runs) shows the admin-configured favicon — mirroring production SSI.
 * Production serves it through nginx SSI against the live API; dev has no SSI processor.
 *
 * Why not the static public/head-fragment-default.html: that file is the "API down" fallback with
 * the build-time default favicon. Serving it unconditionally meant every dev reload first rendered
 * the default icon and only swapped to the custom one once client JS fetched settings — reading as
 * "favicon flickers between default and mine" whenever the tab was glanced at mid-swap (or the
 * local API was slow/restarting, in which case it stayed default for the whole session).
 *
 * The fetched fragment is cached for DEV_HEAD_FRAGMENT_TTL_MS and refetched in the background on
 * expiry, so per-request overhead is one memory read.
 */
const DEV_HEAD_FRAGMENT_TTL_MS = 30_000;

function fetchLiveHeadFragment(): Promise<string> {
  return fetch(`${devProxyTarget}${HEAD_FRAGMENT_PLACEHOLDER}`).then(async (res) => {
    if (!res.ok) throw new Error(`head-fragment ${res.status}`);
    return res.text();
  });
}

function devHeadFragmentPlugin(): Plugin {
  let cachedFragment: string | null = null;
  let cacheAt = 0;
  let inflight: Promise<string> | null = null;

  const readStaticFallback = () => readFileSync(join(__dirname, 'public/head-fragment-default.html'), 'utf8');

  const getFragment = (): Promise<string> => {
    const now = Date.now();
    if (cachedFragment && now - cacheAt < DEV_HEAD_FRAGMENT_TTL_MS) return Promise.resolve(cachedFragment);
    if (inflight) return inflight;
    inflight = fetchLiveHeadFragment()
      .then((fragment) => {
        cachedFragment = fragment;
        cacheAt = now;
        return fragment;
      })
      .catch(() => {
        // 本地 API 没起 / 重启中：退回静态默认片段（与线上 API 挂掉时后端的兜底一致）
        if (!cachedFragment) cachedFragment = readStaticFallback();
        return cachedFragment;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    name: 'dev-head-fragment',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        if (!html.includes(HEAD_FRAGMENT_SSI)) return html;
        const fragment = await getFragment();
        return html.replace(HEAD_FRAGMENT_SSI, fragment.trim());
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
