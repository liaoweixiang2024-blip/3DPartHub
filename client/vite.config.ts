import { readFileSync, writeFileSync } from 'node:fs';
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

/**
 * Build-only: strip comments from the emitted index.html so they don't show up in
 * view-source on production. Vite passes index.html through verbatim — HTML comments
 * and inline <script> bodies (not bundled, not minified) keep every source comment.
 * SSI directives (<!--# ... -->) are preserved: nginx executes them at serve time.
 * Source comments stay in index.html for developers; only the artifact is cleaned.
 */
function stripIndexHtmlCommentsPlugin(): Plugin {
  return {
    name: 'strip-index-html-comments',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          // 1) HTML 注释（负向前瞻保住 <!--# SSI 指令；只吞掉紧跟的一个换行，保留后续行自身缩进）
          .replace(/[ \t]*<!--(?!#)[\s\S]*?-->\n?/g, '')
          // 2) 内联 <script>（无 src，不参与打包压缩）里的整行 // 注释；
          //    只匹配行首缩进后的 //，不会误伤字符串里的 "//"
          .replace(/(<script(?![^>]*\bsrc\b)[^>]*>)([\s\S]*?)(<\/script>)/g, (_m, open: string, body: string, close: string) => {
            const cleaned = body.replace(/^[ \t]*\/\/[^\n]*$\n?/gm, '');
            return `${open}${cleaned}${close}`;
          });
      },
    },
  };
}

/**
 * Build-only: emit dist/version.json next to index.html.
 *
 * UpdateBanner polls /version.json (served no-cache by nginx) and compares it
 * against the build-time __APP_VERSION__ define — a mismatch means the server
 * is running a newer bundle than the page the user is looking at, which is the
 * only reliable signal for iOS home-screen webapps: iOS suspends standalone
 * webapps in the background and RESUMES the old DOM on launch (no navigation,
 * no network request), so a deployed update otherwise stays invisible until
 * the user force-quits the app. dev has no version injected (empty string
 * matches the empty version.json that would emit) and the checker self-disables.
 */
function versionJsonPlugin(): Plugin {
  return {
    name: 'emit-version-json',
    apply: 'build',
    closeBundle() {
      writeFileSync(join(__dirname, 'dist/version.json'), `${JSON.stringify({ version: process.env.VITE_APP_VERSION || '' })}\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devHeadFragmentPlugin(), stripIndexHtmlCommentsPlugin(), versionJsonPlugin()],
  // 构建版本号（CI 传 VITE_APP_VERSION=vX.Y.Z）注入为全局常量，UpdateBanner 用它对比 /version.json
  define: {
    __APP_VERSION__: JSON.stringify(process.env.VITE_APP_VERSION || ''),
  },
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

          // UploadModal / NotificationPanel / MobileNavDrawer 刻意不钉 chunk：
          // 组件由消费方动态 import（preloadNotificationPanel 等），钉包会让
          // manual chunk 吸收一份共享模块 blob 并整体落入入口闭包（首屏 +100KB
          // 级）；自然分包下它们各自跟随动态 import 点，天然懒加载。

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
              normalizedId.includes('/write-excel-file/') ||
              normalizedId.includes('/jszip/')
            ) {
              // return undefined：跟随自然依赖图（只被懒加载方引用的库落在懒 chunk），
              // 不进默认 vendor 桶——那个桶是单块且被入口闭包整体拖成 eager，
              // jszip 曾因此搭车进首屏（~40KB gzip，实际只有懒加载的上传弹窗用它）。
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

          // src/api、src/stores、src/components/shared、src/hooks、src/lib 刻意
          // 不再按目录钉成整包 chunk：目录级钉包会让「入口引用了其中任意一个
          // 模块」就变成整个目录的首屏依赖（首页被迫下载全部管理端 API 与组件，
          // 首屏 JS 多 ~150KB gzip），且改任意一个文件就使大 chunk 哈希失效、
          // 全员重下。交给 Rollup 按消费方自动分包：只有入口真正用到的模块
          // 进首屏，页面专属模块跟随各自的懒路由 chunk，多页共用模块自动生成
          // 共享小 chunk（Rollup 模块级去重，不会重复打包）。
        },
      },
    },
    // The 3D viewer intentionally keeps three.js in a lazy route chunk.
    // It is large by nature, but no longer affects the initial bundle.
    chunkSizeWarningLimit: 1200,
    // 全部 CSS 打进单个入口文件：分包 CSS（如 app-shared 里的标题卡样式）会在首帧
    // 绘制之后才生效，造成移动端「标题先裸文本、后变卡片」的 FOUC 跳动。
    // 合并后入口多 ~50KB CSS（gzip 后更小），换来首帧样式完整。
    cssCodeSplit: false,
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
  // vite preview（本地预览生产构建）与 dev 同源代理，保证 /api、/static 可用
  preview: {
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
      '/site.webmanifest': {
        target: devProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/site\.webmanifest$/, '/api/settings/site-manifest'),
      },
    },
  },
});
