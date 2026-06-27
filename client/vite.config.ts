import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
});
