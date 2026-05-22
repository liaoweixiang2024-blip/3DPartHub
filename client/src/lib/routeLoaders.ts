type RouteModuleLoader = () => Promise<unknown>;

type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export const loadModelDetailPage = () => import('../pages/ModelDetailPage');
export const loadDownloadsPage = () => import('../pages/DownloadsPage');
export const loadFavoritesPage = () => import('../pages/FavoritesPage');
export const loadMySharesPage = () => import('../pages/MySharesPage');
export const loadProfilePage = () => import('../pages/ProfilePage');
export const loadSupportPage = () => import('../pages/SupportPage');
export const loadMyTicketsPage = () => import('../pages/MyTicketsPage');
export const loadLoginPage = () => import('../pages/LoginPage');
export const loadLegalPage = () => import('../pages/LegalPage');
export const loadSharePage = () => import('../pages/SharePage');
export const loadProjectsPage = () => import('../pages/ProjectsPage');
export const loadProjectDetailPage = () => import('../pages/ProjectDetailPage');
export const loadCategoryAdminPage = () => import('../pages/CategoryAdminPage');
export const loadModelAdminPage = () => import('../pages/ModelAdminPage');
export const loadTicketAdminPage = () => import('../pages/TicketAdminPage');
export const loadTicketDetailPage = () => import('../pages/TicketDetailPage');
export const loadSettingsPage = () => import('../pages/SettingsPage');
export const loadUserAdminPage = () => import('../pages/UserAdminPage');
export const loadAuditLogPage = () => import('../pages/AuditLogPage');
export const loadShareAdminPage = () => import('../pages/ShareAdminPage');
export const loadDownloadAdminPage = () => import('../pages/DownloadAdminPage');
export const loadSelectionPage = () => import('../pages/SelectionPage');
export const loadTempViewerPage = () => import('../pages/TempViewerPage');
export const loadThreadSizeToolPage = () => import('../pages/ThreadSizeToolPage');
export const loadProductWallPage = () => import('../pages/ProductWallPage');
export const loadSelectionAdminPage = () => import('../pages/SelectionAdminPage');
export const loadMyInquiriesPage = () => import('../pages/MyInquiriesPage');
export const loadInquiryDetailPage = () => import('../pages/InquiryDetailPage');
export const loadInquiryAdminPage = () => import('../pages/InquiryAdminPage');
export const loadSelectionSharePage = () => import('../pages/SelectionSharePage');

const warmedLoaders = new Set<RouteModuleLoader>();

export function preloadRouteModule(loader: RouteModuleLoader) {
  if (warmedLoaders.has(loader)) return;
  warmedLoaders.add(loader);
  void loader().catch(() => {
    warmedLoaders.delete(loader);
  });
}

export function preloadModelDetailPage() {
  preloadRouteModule(loadModelDetailPage);
}

const exactRouteLoaders = new Map<string, RouteModuleLoader>([
  ['/login', loadLoginPage],
  ['/selection', loadSelectionPage],
  ['/temp-viewer', loadTempViewerPage],
  ['/thread-size', loadThreadSizeToolPage],
  ['/product-wall', loadProductWallPage],
  ['/projects', loadProjectsPage],
  ['/downloads', loadDownloadsPage],
  ['/favorites', loadFavoritesPage],
  ['/my-shares', loadMySharesPage],
  ['/profile', loadProfilePage],
  ['/support', loadSupportPage],
  ['/my-tickets', loadMyTicketsPage],
  ['/my-inquiries', loadMyInquiriesPage],
  ['/admin/categories', loadCategoryAdminPage],
  ['/admin/models', loadModelAdminPage],
  ['/admin/tickets', loadTicketAdminPage],
  ['/admin/settings', loadSettingsPage],
  ['/admin/users', loadUserAdminPage],
  ['/admin/audit', loadAuditLogPage],
  ['/admin/shares', loadShareAdminPage],
  ['/admin/downloads', loadDownloadAdminPage],
  ['/admin/selections', loadSelectionAdminPage],
  ['/admin/inquiries', loadInquiryAdminPage],
]);

const prefixRouteLoaders: Array<[prefix: string, loader: RouteModuleLoader]> = [
  ['/model/', loadModelDetailPage],
  ['/projects/', loadProjectDetailPage],
  ['/my-tickets/', loadTicketDetailPage],
  ['/admin/tickets/', loadTicketDetailPage],
  ['/my-inquiries/', loadInquiryDetailPage],
  ['/admin/inquiries/', loadInquiryDetailPage],
  ['/legal/', loadLegalPage],
  ['/share/', loadSharePage],
  ['/selection/s/', loadSelectionSharePage],
];

function getRoutePathname(path: string) {
  try {
    return new URL(path, window.location.origin).pathname;
  } catch {
    return path.split(/[?#]/)[0] || path;
  }
}

export function preloadRouteForPath(path: string) {
  const pathname = getRoutePathname(path);
  const exactLoader = exactRouteLoaders.get(pathname);
  if (exactLoader) {
    preloadRouteModule(exactLoader);
    return;
  }

  const prefixMatch = prefixRouteLoaders.find(([prefix]) => pathname.startsWith(prefix));
  if (prefixMatch) preloadRouteModule(prefixMatch[1]);
}

function requestRouteIdleCallback(callback: (deadline: IdleDeadlineLike) => void) {
  if (typeof window === 'undefined') return 0;
  const idleWindow = window as WindowWithIdleCallback;
  if (idleWindow.requestIdleCallback) {
    return idleWindow.requestIdleCallback(callback, { timeout: 2500 });
  }
  return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 420);
}

function cancelRouteIdleCallback(handle: number) {
  if (typeof window === 'undefined' || !handle) return;
  const idleWindow = window as WindowWithIdleCallback;
  if (idleWindow.cancelIdleCallback) {
    idleWindow.cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

export function warmRouteModules(role?: string) {
  if (typeof window === 'undefined') return () => {};

  const commonLoaders: RouteModuleLoader[] = [
    loadSelectionPage,
    loadTempViewerPage,
    loadProductWallPage,
    loadProjectsPage,
    loadDownloadsPage,
    loadFavoritesPage,
    loadMySharesPage,
    loadProfilePage,
    loadSupportPage,
    loadMyTicketsPage,
    loadMyInquiriesPage,
  ];

  const adminLoaders: RouteModuleLoader[] =
    role === 'ADMIN'
      ? [
          loadModelAdminPage,
          loadCategoryAdminPage,
          loadDownloadAdminPage,
          loadSelectionAdminPage,
          loadTicketAdminPage,
          loadInquiryAdminPage,
          loadSettingsPage,
          loadUserAdminPage,
        ]
      : [];

  const queue = [...commonLoaders, ...adminLoaders].filter((loader) => !warmedLoaders.has(loader));
  let cancelled = false;
  let idleHandle = 0;

  const runNext = (deadline: IdleDeadlineLike) => {
    if (cancelled) return;
    let loadedInBatch = 0;
    do {
      const loader = queue.shift();
      if (!loader) return;
      preloadRouteModule(loader);
      loadedInBatch += 1;
    } while (queue.length > 0 && loadedInBatch < 2 && deadline.timeRemaining() > 8);

    idleHandle = requestRouteIdleCallback(runNext);
  };

  idleHandle = requestRouteIdleCallback(runNext);

  return () => {
    cancelled = true;
    cancelRouteIdleCallback(idleHandle);
  };
}
