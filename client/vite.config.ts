import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const devProxyTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  assetsInclude: ['**/*.wasm'],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (normalizedId.includes('/node_modules/')) {
            // Keep heavy, route-only toolchains out of the initial vendor chunk.
            if (
              normalizedId.includes('/three/') ||
              normalizedId.includes('/@react-three/') ||
              normalizedId.includes('/@pmndrs/') ||
              normalizedId.includes('/xlsx/')
            ) {
              return
            }
            return 'vendor-app'
          }

          if (
            normalizedId.includes('/src/api/') ||
            normalizedId.includes('/src/components/shared/') ||
            normalizedId.includes('/src/hooks/') ||
            normalizedId.includes('/src/lib/') ||
            normalizedId.includes('/src/stores/')
          ) {
            return 'app-shared'
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
})
