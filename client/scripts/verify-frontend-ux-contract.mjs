import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(clientRoot, '..');
const srcRoot = path.join(clientRoot, 'src');

const readSource = (relativePath) => readFile(path.join(srcRoot, relativePath), 'utf8');

const errors = [];

function requireIncludes(label, source, snippets) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      errors.push(`${label} is missing required UX contract snippet: ${snippet}`);
    }
  }
}

const [
  indexHtmlSource,
  mainSource,
  viteConfigSource,
  appSource,
  globalCssSource,
  homePageSource,
  homeUtilsSource,
  productCardSource,
  classicHomeTemplateSource,
  workbenchHomeTemplateSource,
  modelDetailPageSource,
  publicSettingsSource,
  sentryLazySource,
  routeLoadersSource,
  routerSource,
  adminPageShellSource,
  publicPageShellSource,
  preloadNotificationPanelSource,
  topNavSource,
  bottomNavRendererSource,
  mobileNavDrawerRendererSource,
  sidebarRendererSource,
  protectedLinkSource,
  modelAdminSource,
  notificationPanelSource,
  modelThumbnailSource,
  modelViewerSource,
  cadViewerPanelSource,
  modelDetailFrameSource,
  modelDetailSkeletonSource,
  pageRefreshFallbackSource,
  routeProgressSource,
  sharePageSource,
  paginationSource,
  infiniteLoadTriggerSource,
  clientBusinessConfigSource,
  settingsPageSource,
  settingsUtilsSource,
  serverBusinessConfigSource,
  serverBusinessDefaultsSource,
  serverModelListSource,
] = await Promise.all([
  readFile(path.join(clientRoot, 'index.html'), 'utf8'),
  readSource('main.tsx'),
  readFile(path.join(clientRoot, 'vite.config.ts'), 'utf8'),
  readSource('App.tsx'),
  readSource('styles/global.css'),
  readSource('pages/HomePage.tsx'),
  readSource('components/home/homeUtils.ts'),
  readSource('components/home/ProductCard.tsx'),
  readSource('themes/interfaceThemes/classic/templates/HomeDesktop.tsx'),
  readSource('themes/interfaceThemes/workbench/templates/HomeDesktop.tsx'),
  readSource('pages/ModelDetailPage.tsx'),
  readSource('lib/publicSettings.ts'),
  readSource('lib/sentryLazy.ts'),
  readSource('lib/routeLoaders.ts'),
  readSource('router.tsx'),
  readSource('components/shared/AdminPageShell.tsx'),
  readSource('components/shared/PublicPageShell.tsx'),
  readSource('components/shared/preloadNotificationPanel.ts'),
  readSource('components/shared/TopNav.tsx'),
  readSource('themes/mobileThemes/shared/BottomNavRenderer.tsx'),
  readSource('themes/mobileThemes/shared/MobileNavDrawerRenderer.tsx'),
  readSource('themes/interfaceThemes/shared/SidebarRenderer.tsx'),
  readSource('components/shared/ProtectedLink.tsx'),
  readSource('pages/ModelAdminPage.tsx'),
  readSource('components/shared/NotificationPanel.tsx'),
  readSource('components/shared/ModelThumbnail.tsx'),
  readSource('components/3d/ModelViewer.tsx'),
  readSource('components/3d/CadViewerPanel.tsx'),
  readSource('components/shared/ModelDetailFrame.tsx'),
  readSource('components/shared/ModelDetailPageSkeleton.tsx'),
  readSource('components/shared/PageRefreshFallback.tsx'),
  readSource('components/shared/RouteProgress.tsx'),
  readSource('pages/SharePage.tsx'),
  readSource('components/shared/Pagination.tsx'),
  readSource('components/shared/InfiniteLoadTrigger.tsx'),
  readSource('lib/businessConfig.ts'),
  readSource('pages/SettingsPage.tsx'),
  readSource('lib/settingsUtils.ts'),
  readFile(path.join(repoRoot, 'server/src/lib/businessConfig.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'server/src/lib/businessDefaults.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'server/src/routes/models/list.ts'), 'utf8'),
]);

const desktopHomeTemplatesSource = `${classicHomeTemplateSource}\n${workbenchHomeTemplateSource}`;
const homeListSources = `${homePageSource}\n${desktopHomeTemplatesSource}`;
const homePageWithUtils = `${homePageSource}\n${homeUtilsSource}\n${productCardSource}`;

requireIncludes('index.html font preload', indexHtmlSource, [
  'space-grotesk-latin-400-normal.woff2',
  'space-grotesk-latin-700-normal.woff2',
]);
if (indexHtmlSource.includes('rel="preload" href="/fonts/space-grotesk-latin-600-normal.woff2"')) {
  errors.push('index.html must not high-priority preload the non-critical Space Grotesk 600 font.');
}

requireIncludes('main.tsx', mainSource, [
  "import { scheduleSentryInit } from './lib/sentryLazy';",
  'scheduleSentryInit();',
]);

requireIncludes('vite.config.ts', viteConfigSource, [
  "return 'upload-modal';",
  "return 'notification-panel';",
  "return 'mobile-nav-drawer';",
  "normalizedId.includes('/@sentry/')",
  "normalizedId.includes('/read-excel-file/')",
  "normalizedId.includes('/write-excel-file/')",
]);

if (mainSource.includes("./lib/sentry'") || mainSource.includes('./lib/sentry"')) {
  errors.push('main.tsx must not statically import the Sentry SDK wrapper on the startup path.');
}

requireIncludes('sentryLazy.ts', sentryLazySource, [
  'requestIdleCallback(init, { timeout: 3000 })',
  "void import('./sentry')",
  'window.setTimeout(init, 2500)',
]);

requireIncludes('publicSettings.ts startup refresh', publicSettingsSource, [
  'function schedulePublicSettingsRefresh()',
  'requestIdleCallback(refresh, { timeout: 2500 })',
  'window.setTimeout(refresh, 1200)',
  'if (cache) {',
  'schedulePublicSettingsRefresh();',
  'return fetchAndApplyPublicSettings();',
]);

requireIncludes('App.tsx', appSource, [
  '<MotionConfig reducedMotion="user"',
  '<RouteProgress />',
  '<GlobalPageRefreshIndicator />',
]);

requireIncludes('HomePage.tsx native home list', homePageWithUtils, [
  'const HOME_DESKTOP_GRID_EAGER_IMAGES = 10;',
  'const HOME_DESKTOP_LIST_EAGER_IMAGES = 6;',
  'const HOME_MOBILE_EAGER_IMAGES = 4;',
  'const DesktopHome = ThemePackage.templates.DesktopHome;',
  'renderDesktopProductCard',
  'products.map((product, index) => {',
]);

for (const [label, source] of [
  ['classic HomeDesktop.tsx native home list', classicHomeTemplateSource],
  ['workbench HomeDesktop.tsx native home list', workbenchHomeTemplateSource],
]) {
  requireIncludes(label, source, [
    'renderProductCard',
    'aria-label="网格视图"',
    'aria-label="列表视图"',
    '{showHomeListSkeleton ? (',
  ]);
}

requireIncludes('global.css', globalCssSource, ['contain: layout paint style;']);
for (const snippet of [
  'HOME_DESKTOP_GRID_VIRTUALIZATION_ENABLED',
  'HOME_DESKTOP_VIRTUAL_MIN_ITEMS',
  'HOME_DESKTOP_LIST_VIRTUAL_MIN_ITEMS',
  'HOME_MOBILE_VIRTUAL_MIN_ITEMS',
  'HOME_DESKTOP_GRID_OVERSCAN_ROWS',
  'HOME_DESKTOP_LIST_OVERSCAN_ROWS',
  'HOME_MOBILE_GRID_OVERSCAN_ROWS',
  'DesktopVirtualMetrics',
  'GridVirtualMetrics',
  'getHomeVirtualWindow',
  'getHomeVirtualGridAutoRows',
  'areDesktopVirtualMetricsEqual',
  'shouldVirtualizeDesktopGrid',
  'shouldVirtualizeDesktopList',
  'shouldVirtualizeMobileGrid',
  'desktopVirtualWindow',
  'desktopListVirtualWindow',
  'mobileVirtualWindow',
  'desktopVirtualOuterRef',
  'desktopListVirtualOuterRef',
  'mobileVirtualOuterRef',
  'primeHomeVirtualWindowForModel',
  'gridAutoRows:',
  'desktopVirtualWindow.topOffset',
  'desktopListVirtualWindow.topOffset',
  'mobileVirtualWindow.topOffset',
  'desktopVirtualWindow.totalHeight',
  'desktopListVirtualWindow.totalHeight',
  'mobileVirtualWindow.totalHeight',
]) {
  if (homeListSources.includes(snippet)) {
    errors.push(`Home page model list must stay fully native and must not include virtual-list code: ${snippet}`);
  }
}
if (globalCssSource.includes('content-visibility: auto')) {
  errors.push('Home page model list must not use content-visibility; keep normal browser-native rendering.');
}
if (
  /HOME_DESKTOP_WHEEL|HOME_DESKTOP_SMOOTH_WHEEL|DesktopWheelMomentumState|HomeDesktopSmoothWheelState|desktopSmoothWheelRef|desktopWheelMomentumRef|normalizeHomeWheelDelta|clampHomeWheelScrollTop|clampHomeScrollTop|handleWheel|handleSmoothWheel|cancelMomentum|addEventListener\('wheel'/.test(
    homePageSource,
  )
) {
  errors.push('Home page desktop wheel scrolling must stay native and must not be intercepted by custom JS.');
}
if (/home-scroll-active|scrollHover/.test(homePageSource) || /home-scroll-active/.test(globalCssSource)) {
  errors.push('Home page must not add scroll-active hover suppression; keep native scrolling behavior untouched.');
}
if (globalCssSource.includes('data-home-wheel-momentum') || globalCssSource.includes('box-shadow: none !important;')) {
  errors.push('Home page card shadow styling must stay unchanged during scroll.');
}

requireIncludes('HomePage.tsx image priority', homePageSource, [
  'HOME_DESKTOP_GRID_EAGER_IMAGES',
  'HOME_MOBILE_EAGER_IMAGES',
  "imageLoading={shouldPrioritizeImage ? 'eager' : 'lazy'}",
  "imageFetchPriority={shouldPrioritizeImage ? 'high' : 'auto'}",
]);

requireIncludes('HomePage.tsx mobile pull refresh', homePageSource, [
  'className="flex items-center justify-center gap-2 text-xs text-on-surface-variant select-none overflow-hidden"',
  "transition: pullState === 'idle' ? 'height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none'",
  '<Icon name="autorenew" size={18} className="text-primary-container animate-spin" />',
  'name="arrow_downward"',
  'className="text-primary-container transition-transform duration-200"',
  "style={{ transform: pullState === 'ready' ? 'rotate(180deg)' : 'rotate(0deg)' }}",
  "pullState === 'refreshing' ? '正在刷新...' : pullState === 'ready' ? '松开刷新' : '下拉刷新'",
  'Keep the spinner visible at least 800ms',
  'if (elapsed < 800) {',
  'setTimeout(r, 800 - elapsed)',
]);
if (homePageSource.includes('HOME_PULL_REFRESH_MIN_VISIBLE_MS')) {
  errors.push('HomePage.tsx mobile pull-to-refresh timing must stay aligned with the v2.9.4 800ms behavior.');
}

requireIncludes('HomePage.tsx category refresh', homePageWithUtils, [
  'const [listRefreshPending, setListRefreshPending] = useState(false);',
  'const pendingHomeListRefreshResetRef = useRef(false);',
  'const showHomeListSkeleton = isLoading || (!usesManualHomePagination && listRefreshPending);',
  "const resetHomeListViewportForRefresh = useCallback((target: HomeRefreshScrollTarget = 'top', immediate = false) => {",
  "const HOME_REFRESH_SCROLL_TARGET: HomeRefreshScrollTarget = 'results';",
  'pendingHomeListRefreshTargetRef.current = target;',
  'if (!listRefreshPending || !pendingHomeListRefreshResetRef.current) return;',
  "pendingHomeListRefreshTargetRef.current === 'results'",
  'const shouldRefreshList = query !== searchQuery || (query && activeCategory !==',
  'const shouldRefreshList = normalizedSort !== sortBy || page !== 1;',
  'setListRefreshPending(true);',
  'resetHomeListViewportForRefresh(HOME_REFRESH_SCROLL_TARGET, usesManualHomePagination);',
  'const handlePageChange = useCallback(',
  'const handlePageSizeChange = useCallback(',
  'setPageSize(nextPageSize);',
  'const activeCategoryCount = useMemo(() => {',
  '(showHomeListSkeleton || listRefreshPending) && activeCategoryCount != null',
]);
if (homePageSource.includes("scrollTo({ top: 0, behavior: 'smooth' })")) {
  errors.push(
    'HomePage.tsx list reset interactions must use the list refresh flow instead of visible smooth top jumps.',
  );
}

requireIncludes('Pagination.tsx page-size defaults', paginationSource, [
  'export const DEFAULT_PAGE_SIZE = 20;',
  'export const PAGE_SIZE_OPTIONS = [20, 40, 60, 120] as const;',
]);

requireIncludes('InfiniteLoadTrigger.tsx observability', infiniteLoadTriggerSource, [
  'idleLabel?: string | null;',
  "idleLabel = '继续滚动自动加载',",
  'const showIdleLabel = idleLabel !== null;',
  "className={`flex justify-center ${showStatus ? 'py-3' : 'h-px py-0'} ${className}`}",
  '{isLoading ? loadingLabel : idleLabel}',
  'data-infinite-load-trigger',
  'data-infinite-load-mode="buttonless"',
  'data-infinite-load-mode="button"',
  "data-infinite-load-state={isLoading ? 'loading' : 'idle'}",
]);

requireIncludes('HomePage.tsx theme-controlled list loading', homePageSource, [
  'const MobileThemePackage = getMobileThemePackage(publicSettings?.mobile_interface_theme);',
  'const mobileHomeBehavior = MobileThemePackage.home;',
  "(isDesktop ? desktopHomeBehavior.listLoadingMode : mobileHomeBehavior.listLoadingMode) === 'pagination';",
  'useInfiniteModels(',
  '{ manual: usesManualHomePagination }',
  'setModelPageSize(usesManualHomePagination ? 1 : page);',
]);
requireIncludes('classic HomeDesktop.tsx infinite loading', classicHomeTemplateSource, [
  '<InfiniteLoadTrigger',
  'buttonless',
  'idleLabel={null}',
]);
requireIncludes('workbench HomeDesktop.tsx pagination loading', workbenchHomeTemplateSource, [
  '<Pagination',
  'pageSizeOptions={homePageSizeOptions}',
  'onPageChange=',
  'onPageSizeChange=',
]);
if (classicHomeTemplateSource.includes('<Pagination')) {
  errors.push('classic HomeDesktop.tsx must keep the legacy automatic infinite loading interaction.');
}
if (workbenchHomeTemplateSource.includes('<InfiniteLoadTrigger')) {
  errors.push('workbench HomeDesktop.tsx must use pagination, not the classic infinite loading interaction.');
}

requireIncludes('HomePage.tsx legacy page-size migration', homePageWithUtils, [
  'const HOME_LEGACY_DEFAULT_PAGE_SIZE = 60;',
  'function normalizeStoredHomePageSize',
  'Math.floor(parsed) === HOME_LEGACY_DEFAULT_PAGE_SIZE',
  'readPendingHomeBrowseState(homeDefaultPageSize)',
  "searchParams.has('page_size')",
]);

for (const [label, source] of [
  ['client businessConfig.ts home page size policy', clientBusinessConfigSource],
  ['SettingsPage.tsx / settingsUtils.ts home page size defaults', settingsPageSource + settingsUtilsSource],
  ['server businessConfig.ts home page size policy', serverBusinessConfigSource],
  ['server businessDefaults.ts home page size defaults', serverBusinessDefaultsSource],
]) {
  requireIncludes(label, source, [
    'homeDefault: 20,',
    'homeOption1: 20,',
    'homeOption2: 40,',
    'homeOption3: 60,',
    'homeOption4: 120,',
  ]);
}
requireIncludes('server models list page-size fallback', serverModelListSource, [
  'const defaultPageSize = Math.max(1, Math.floor(Number(pageSizePolicy.homeDefault) || 20));',
]);
requireIncludes('HomePage.tsx model detail intent preload', homePageWithUtils, [
  'onPointerDown={preloadModelDetailPage}',
  'onFocus={preloadModelDetailPage}',
]);
if (homePageSource.includes('onPointerEnter={preloadModelDetailPage}')) {
  errors.push(
    'HomePage.tsx must avoid hover-preloading model details because that path warms 3D viewer code during scroll.',
  );
}

requireIncludes('ModelThumbnail.tsx', modelThumbnailSource, [
  "fetchPriority?: 'high' | 'low' | 'auto';",
  'fetchPriority={fetchPriority}',
  'decoding="async"',
]);

requireIncludes('routeLoaders.ts', routeLoadersSource, [
  'const warmedLoaders = new Set<RouteModuleLoader>();',
  'export function preloadRouteForPath(path: string)',
  'export function warmRouteModules(role?: string)',
  'requestIdleCallback(callback, { timeout: 2500 })',
  'callback({ didTimeout: false, timeRemaining: () => 0 })',
  'loadedInBatch < 2',
  "role === 'ADMIN'",
]);

requireIncludes('router.tsx', routerSource, [
  'function RoutePreloadTracker()',
  "if (event.type === 'pointerover' && isModelDetailPath(url.pathname)) return;",
  "window.addEventListener('pointerover', preloadFromEvent, { passive: true });",
  "window.addEventListener('pointerdown', preloadFromEvent, { passive: true });",
  "window.addEventListener('focusin', preloadFromEvent);",
  'return warmRouteModules(role);',
  '<RoutePreloadTracker />',
]);

requireIncludes('AdminPageShell.tsx theme shell', adminPageShellSource, [
  'const ThemePackage = useInterfaceThemeShellComponents();',
  'const MobileThemePackage = useMobileThemeShellComponents();',
  'const BottomNav = MobileThemePackage.components.BottomNav;',
  'const MobileNavDrawer = MobileThemePackage.components.MobileNavDrawer;',
  '<MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />',
]);

requireIncludes('PublicPageShell.tsx theme shell', publicPageShellSource, [
  'const ThemePackage = getInterfaceThemePackage(settings?.interface_theme);',
  'const MobileThemePackage = getMobileThemePackage(settings?.mobile_interface_theme);',
  'const BottomNav = MobileThemePackage.components.BottomNav;',
  'const MobileNavDrawer = MobileThemePackage.components.MobileNavDrawer;',
  '<MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />',
]);

requireIncludes('TopNav.tsx', topNavSource, [
  "import { preloadRouteForPath } from '../../lib/routeLoaders';",
  "import { loadNotificationPanel, scheduleNotificationPanelPreload } from './preloadNotificationPanel';",
  'const NotificationPanel = lazy(loadNotificationPanel);',
  'scheduleNotificationPanelPreload();',
  'function NotificationPanelFallback',
  'const preloadUploadModal = () => import(',
  'onPointerEnter={() => preloadRouteForPath(item.path)}',
  'onPointerDown={() => preloadRouteForPath(item.path)}',
  'onFocus={() => preloadRouteForPath(item.path)}',
  'onPointerEnter={preloadUploadModal}',
  'onPointerDown={preloadUploadModal}',
  'onFocus={preloadUploadModal}',
]);
if (topNavSource.includes("import NotificationPanel from './NotificationPanel';")) {
  errors.push('TopNav.tsx must lazy-load NotificationPanel instead of putting it on the first-paint path.');
}

requireIncludes('preloadNotificationPanel.ts', preloadNotificationPanelSource, [
  "import('./NotificationPanel')",
  'requestIdleCallback(preload, { timeout: 2200 })',
  'window.setTimeout(preload, 850)',
]);

for (const [label, source] of [
  ['BottomNavRenderer.tsx', bottomNavRendererSource],
  ['MobileNavDrawerRenderer.tsx', mobileNavDrawerRendererSource],
  ['SidebarRenderer.tsx', sidebarRendererSource],
]) {
  requireIncludes(label, source, [
    "import { preloadRouteForPath } from '../../../lib/routeLoaders';",
    'onPointerEnter={() => preloadRouteForPath(',
    'onPointerDown={() => preloadRouteForPath(',
    'onFocus={() => preloadRouteForPath(',
  ]);
}

requireIncludes('ProtectedLink.tsx', protectedLinkSource, [
  "import { preloadRouteForPath } from '../../lib/routeLoaders';",
  'onPointerEnter={() => preloadRouteForPath(',
  'onPointerDown={() => preloadRouteForPath(',
  'onFocus={() => preloadRouteForPath(',
]);

requireIncludes('ModelAdminPage.tsx', modelAdminSource, [
  "const preloadUploadModal = () => import('../components/shared/UploadModal');",
  'onPointerEnter={preloadUploadModal}',
  'onPointerDown={preloadUploadModal}',
  'onFocus={preloadUploadModal}',
]);

requireIncludes('NotificationPanel.tsx', notificationPanelSource, [
  'const NOTIFICATION_LIST_STALE_MS = 30_000;',
  'listInflightRef',
  'void fetchNotifications({ preload: true });',
  'onPointerEnter={handleNotificationIntent}',
  'onPointerDown={handleNotificationIntent}',
  'onFocus={handleNotificationIntent}',
]);

requireIncludes('PageRefreshFallback.tsx', pageRefreshFallbackSource, ['export function usePageRefreshActive()']);

requireIncludes('ModelDetailFrame.tsx shared frame', modelDetailFrameSource, [
  'export const MODEL_DETAIL_VIEWER_CLASS =',
  'data-model-detail-sidebar',
  'data-model-detail-header',
  'data-model-detail-specs',
  'data-model-detail-downloads',
  'data-model-detail-support',
]);

requireIncludes('ModelDetailPageSkeleton.tsx frame usage', modelDetailSkeletonSource, [
  "from './ModelDetailFrame';",
  '<ModelDetailDesktopFrame layout="skeleton" busy>',
  '<section className={MODEL_DETAIL_VIEWER_CLASS} data-model-detail-viewer />',
  '<ModelDetailAsideFrame',
]);

requireIncludes('CadViewerPanel.tsx model detail frame', cadViewerPanelSource, [
  "import { MODEL_DETAIL_VIEWER_CLASS } from '../shared/ModelDetailFrame';",
  ': MODEL_DETAIL_VIEWER_CLASS;',
  "data-model-detail-viewer={isMobile ? undefined : ''}",
]);

requireIncludes('ModelDetailPage.tsx shared frame usage', modelDetailPageSource, [
  "from '../components/shared/ModelDetailFrame';",
  "import ModelDetailPageSkeleton from '../components/shared/ModelDetailPageSkeleton';",
]);

requireIncludes('RouteProgress.tsx', routeProgressSource, [
  'const pageRefreshActive = usePageRefreshActive();',
  'const MAX_WAIT_MS = 8000;',
  'const progressRef = useRef(0);',
  'const [transitionId, setTransitionId] = useState(0);',
  'const setRouteProgressAtLeast = useCallback(',
  'setTransitionId((value) => value + 1);',
  'setRouteProgressAtLeast(18);',
  'setRouteProgressAtLeast(58);',
  'setRouteProgressAtLeast(86);',
  'key={transitionId}',
  'if (!routePendingRef.current) return;',
  "if (!routePendingRef.current || phase === 'idle' || phase === 'exiting' || pageRefreshActive) return;",
  'const remaining = Math.max(0, SETTLE_DELAY_MS - (now - routeStartedAtRef.current));',
  'window.setTimeout(completeRouteProgress, MAX_WAIT_MS)',
  'data-route-progress',
  'data-route-progress-phase={phase}',
  'data-route-progress-bar',
]);

requireIncludes('ModelViewer.tsx', modelViewerSource, [
  'export function preloadModelViewerRuntime()',
  'void Promise.all([',
  'loadCanvas()',
  'loadScene()',
  'loadMultiFormatLoader()',
  'loadOrbitControls()',
  'preloadModelViewerRuntime();',
]);

requireIncludes('SharePage.tsx', sharePageSource, [
  "const loadModelViewer = () => import('../components/3d/ModelViewer');",
  'if (data.allowPreview && data.gltfUrl) void loadModelViewer();',
]);

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('Frontend UX contract verified.');
