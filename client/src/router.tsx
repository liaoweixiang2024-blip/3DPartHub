import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { AdminLayout, AdminPageShell, PublicLayout } from './components/shared/AdminPageShell';
import AuthModal from './components/shared/AuthModal';
import BrandMark from './components/shared/BrandMark';
import ErrorBoundary from './components/shared/ErrorBoundary';
import Icon from './components/shared/Icon';
import MaintenanceGate from './components/shared/MaintenanceGate';
import ModelDetailPageSkeleton from './components/shared/ModelDetailPageSkeleton';
import PageRefreshFallback from './components/shared/PageRefreshFallback';
import { checkProtectedAccess, isAuthModalEnabled } from './components/shared/ProtectedLink';
import { useMediaQuery } from './layouts/hooks/useMediaQuery';
import { useResolvedAdminInterfaceTheme, useResolvedPublicInterfaceTheme } from './lib/interfaceThemePreference';
import { getCachedModelDetailTitle } from './lib/modelDetailTitleCache';
import { isModelDetailPath, saveModelReturnPath } from './lib/modelReturnPath';
import { refreshSiteConfig, usePublicSettings } from './lib/publicSettings';
import {
  loadAuditLogPage,
  loadCategoryAdminPage,
  loadDownloadAdminPage,
  loadDownloadsPage,
  loadFavoritesPage,
  loadInquiryAdminPage,
  loadInquiryDetailPage,
  loadLegalPage,
  loadLoginPage,
  loadModelAdminPage,
  loadModelDetailPage,
  loadMyInquiriesPage,
  loadMySharesPage,
  loadMyTicketsPage,
  loadProductWallPage,
  loadProfilePage,
  loadProjectDetailPage,
  loadProjectsPage,
  loadSelectionAdminPage,
  loadSelectionPage,
  loadSelectionSharePage,
  loadSettingsPage,
  loadShareAdminPage,
  loadSharePage,
  loadSupportPage,
  loadTempViewerPage,
  loadThreadSizeToolPage,
  loadTicketAdminPage,
  loadTicketDetailPage,
  loadUserAdminPage,
  preloadRouteForPath,
  warmRouteModules,
} from './lib/routeLoaders';
// Static import for the landing page — eliminates flash on first visit
import HomePage from './pages/HomePage';
import { useAuthStore } from './stores/useAuthStore';
import { getInterfaceThemePackage } from './themes/interfaceThemes/registry';

// Lazy-loaded pages — Vite generates separate chunks automatically
const ModelDetailPage = lazy(loadModelDetailPage);
const DownloadsPage = lazy(loadDownloadsPage);
const FavoritesPage = lazy(loadFavoritesPage);
const MySharesPage = lazy(loadMySharesPage);
const ProfilePage = lazy(loadProfilePage);
const SupportPage = lazy(loadSupportPage);
const MyTicketsPage = lazy(loadMyTicketsPage);
const LoginPage = lazy(loadLoginPage);
const LegalPage = lazy(loadLegalPage);
const SharePage = lazy(loadSharePage);
const ProjectsPage = lazy(loadProjectsPage);
const ProjectDetailPage = lazy(loadProjectDetailPage);
const CategoryAdminPage = lazy(loadCategoryAdminPage);
const ModelAdminPage = lazy(loadModelAdminPage);
const TicketAdminPage = lazy(loadTicketAdminPage);
const TicketDetailPage = lazy(loadTicketDetailPage);
const SettingsPage = lazy(loadSettingsPage);
const UserAdminPage = lazy(loadUserAdminPage);
const AuditLogPage = lazy(loadAuditLogPage);
const ShareAdminPage = lazy(loadShareAdminPage);
const DownloadAdminPage = lazy(loadDownloadAdminPage);
const SelectionPage = lazy(loadSelectionPage);
const TempViewerPage = lazy(loadTempViewerPage);
const ThreadSizeToolPage = lazy(loadThreadSizeToolPage);
const ProductWallPage = lazy(loadProductWallPage);
const SelectionAdminPage = lazy(loadSelectionAdminPage);
const MyInquiriesPage = lazy(loadMyInquiriesPage);
const InquiryDetailPage = lazy(loadInquiryDetailPage);
const InquiryAdminPage = lazy(loadInquiryAdminPage);
const SelectionSharePage = lazy(loadSelectionSharePage);

function RouteFallback({ standalone = false }: { standalone?: boolean }) {
  const location = useLocation();
  const isAdmin = useAuthStore((state) => state.user?.role === 'ADMIN');

  if (isModelDetailPath(location.pathname)) {
    const routeState = location.state as { modelName?: string | null } | null;
    const modelId = decodeURIComponent(location.pathname.replace(/^\/model\//, '').replace(/\/$/, ''));
    const modelTitle = routeState?.modelName?.trim() || getCachedModelDetailTitle(modelId);
    return <ModelDetailPageSkeleton modelTitle={modelTitle} isAdmin={isAdmin} />;
  }

  return <PageRefreshFallback standalone={standalone} />;
}

function PageWrap({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function ProtectedAccessState({
  icon,
  title,
  description,
  primary,
  secondary,
}: {
  icon: string;
  title: string;
  description: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  return (
    <AdminPageShell
      desktopContentClassName="items-center justify-center"
      mobileContentClassName="min-h-full justify-center"
    >
      <section
        className="flex min-h-[340px] min-w-0 flex-col items-center justify-center rounded-xl border border-outline-variant/15 bg-surface-container-low px-6 py-12 text-center shadow-sm"
        style={{ width: 'min(36rem, calc(100vw - 2rem))' }}
      >
        <span className="grid h-16 w-16 place-items-center rounded-2xl border border-outline-variant/15 bg-surface-container text-on-surface-variant/55">
          <Icon name={icon} size={34} />
        </span>
        <h1 className="mt-4 text-base font-bold text-on-surface">{title}</h1>
        <p
          className="mt-1 max-w-full text-xs leading-relaxed text-on-surface-variant sm:max-w-sm"
          style={{ overflowWrap: 'anywhere' }}
        >
          {description}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {secondary}
          {primary}
        </div>
      </section>
    </AdminPageShell>
  );
}

// Protected pages — check auth BEFORE rendering
// so redirect to login is instant (no exit animation delay)
function ProtectedPage({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string }) {
  const { t } = useTranslation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const restoreSessionFromCookie = useAuthStore((s) => s.restoreSessionFromCookie);
  const location = useLocation();
  const navigate = useNavigate();
  const [authRetryDone, setAuthRetryDone] = useState(false);
  const [authRetrying, setAuthRetrying] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const { settings, isLoading: settingsLoading } = usePublicSettings();

  useEffect(() => {
    if (!hasHydrated || isAuthenticated || authRetryDone || authRetrying) return;

    setAuthRetrying(true);
    void restoreSessionFromCookie().finally(() => {
      setAuthRetryDone(true);
      setAuthRetrying(false);
    });
  }, [authRetryDone, authRetrying, hasHydrated, isAuthenticated, restoreSessionFromCookie]);

  if (!hasHydrated || authRetrying || (!isAuthenticated && !authRetryDone) || (settingsLoading && !settings)) {
    return <RouteFallback />;
  }

  if (!isAuthenticated) {
    const access = checkProtectedAccess(location.pathname, settings);
    const returnUrl = `${location.pathname}${location.search}${location.hash}`;
    const authModalEnabled = isAuthModalEnabled(settings);
    if (access.action === 'dialog') {
      return (
        <ProtectedAccessState
          icon="lock"
          title={t('protected.loginTitle')}
          description={t('protected.loginDescription', { reason: access.reason })}
          secondary={
            <Link
              to="/"
              className="inline-flex h-9 items-center justify-center rounded-sm border border-outline-variant/30 px-4 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              {t('protected.backToModels')}
            </Link>
          }
          primary={
            <>
              <button
                type="button"
                onClick={async () => {
                  let latestSettings = settings;
                  try {
                    latestSettings = await refreshSiteConfig();
                  } catch {
                    latestSettings = settings;
                  }
                  if (isAuthModalEnabled(latestSettings)) {
                    setAuthDialogOpen(true);
                    return;
                  }
                  navigate('/login', { state: { from: returnUrl } });
                }}
                className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98]"
              >
                {t('protected.goLogin')}
              </button>
              {authDialogOpen ? (
                <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} returnUrl={returnUrl} />
              ) : null}
            </>
          }
        />
      );
    }
    if (authModalEnabled) {
      return <AuthModal open onClose={() => navigate('/')} returnUrl={returnUrl} />;
    }
    return <Navigate to="/login" state={{ from: returnUrl }} replace />;
  }
  if (requiredRole && user?.role !== requiredRole) {
    return (
      <ProtectedAccessState
        icon="admin_panel_settings"
        title={t('protected.permissionTitle')}
        description={t('protected.permissionDescription')}
        primary={
          <Link
            to="/"
            className="inline-flex h-9 items-center justify-center rounded-sm bg-primary-container px-4 text-sm font-bold text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98]"
          >
            {t('protected.backToModels')}
          </Link>
        }
      />
    );
  }

  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

// No wrapper — let the page handle its own height/scrolling
function ScrollPage({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback standalone />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function NotFoundPage() {
  const { t } = useTranslation();
  const { settings } = usePublicSettings();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const resolvedPublicTheme = useResolvedPublicInterfaceTheme(settings, isDesktop);
  const ThemePackage = getInterfaceThemePackage(resolvedPublicTheme);
  const NotFound = ThemePackage.templates.NotFound;

  return (
    <NotFound
      brand={<BrandMark size="nav" centered />}
      title={
        <>
          <Icon name="search_off" size={56} className="mx-auto text-on-surface-variant/50" />
          <h1 className="mt-4 text-2xl font-headline font-bold text-on-surface">{t('notFound.title')}</h1>
        </>
      }
      description={<p className="text-sm text-on-surface-variant">{t('notFound.description')}</p>}
      homeLink={
        <Link to="/" className="text-primary-container hover:underline">
          {t('notFound.home')}
        </Link>
      }
    />
  );
}

function AdminDefaultRedirect() {
  const location = useLocation();
  const { settings, isLoading } = usePublicSettings();
  const resolvedAdminTheme = useResolvedAdminInterfaceTheme(settings);

  if (isLoading && !settings) {
    return <RouteFallback />;
  }

  const ThemePackage = getInterfaceThemePackage(resolvedAdminTheme);
  const defaultPath =
    ThemePackage.chrome.adminLayout.defaultPath?.({
      pathname: location.pathname,
      isAdminRoute: true,
    }) || '/admin/models';

  return <Navigate to={defaultPath} replace />;
}

function ModelReturnPathTracker() {
  const location = useLocation();

  useEffect(() => {
    if (isModelDetailPath(location.pathname) || location.pathname === '/login') return;
    saveModelReturnPath(`${location.pathname}${location.search}${location.hash}`);
  }, [location.hash, location.pathname, location.search]);

  return null;
}

function RoutePreloadTracker() {
  useEffect(() => {
    const preloadFromEvent = (event: Event) => {
      if (!(event.target instanceof Element)) return;

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;

      const rawHref = anchor.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (event.type === 'pointerover' && isModelDetailPath(url.pathname)) return;

      preloadRouteForPath(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener('pointerover', preloadFromEvent, { passive: true });
    window.addEventListener('pointerdown', preloadFromEvent, { passive: true });
    window.addEventListener('focusin', preloadFromEvent);

    return () => {
      window.removeEventListener('pointerover', preloadFromEvent);
      window.removeEventListener('pointerdown', preloadFromEvent);
      window.removeEventListener('focusin', preloadFromEvent);
    };
  }, []);

  return null;
}

/** Periodically check token validity and refresh when near expiry */
function useTokenWatcher() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const checkAndRefreshToken = useAuthStore((s) => s.checkAndRefreshToken);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return;

    const check = () => {
      // Skip if browser is offline — avoid false-positive logouts from network failures
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      checkAndRefreshToken();
    };

    // Initial check
    check();

    // Then check every 5 minutes (token lifetime is 7 days, no need for 60s polling)
    timerRef.current = setInterval(check, 300_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasHydrated, isAuthenticated, checkAndRefreshToken]);
}

export default function Router() {
  const location = useLocation();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const role = useAuthStore((s) => s.user?.role);
  useTokenWatcher();

  useEffect(() => {
    if (!hasHydrated) return;
    return warmRouteModules(role);
  }, [hasHydrated, role]);

  return (
    <MaintenanceGate>
      <ModelReturnPathTracker />
      <RoutePreloadTracker />
      <Routes location={location}>
        {/* ── No shell ── */}
        <Route
          path="/login"
          element={
            <ScrollPage>
              <LoginPage />
            </ScrollPage>
          }
        />
        <Route
          path="/register"
          element={
            <ScrollPage>
              <LoginPage />
            </ScrollPage>
          }
        />

        {/* ── Public layout (TopNav, no sidebar) ── */}
        <Route element={<PublicLayout />}>
          <Route
            path="/"
            element={
              <PageWrap>
                <HomePage />
              </PageWrap>
            }
          />
          <Route
            path="/model/:id"
            element={
              <PageWrap>
                <ModelDetailPage />
              </PageWrap>
            }
          />
          <Route
            path="/temp-viewer"
            element={
              <ProtectedPage>
                <TempViewerPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/legal/:type"
            element={
              <PageWrap>
                <LegalPage />
              </PageWrap>
            }
          />
          <Route
            path="/share/:token"
            element={
              <PageWrap>
                <SharePage />
              </PageWrap>
            }
          />
          <Route
            path="/selection/s/:token"
            element={
              <PageWrap>
                <SelectionSharePage />
              </PageWrap>
            }
          />
        </Route>

        {/* ── Admin layout (TopNav + Sidebar) ── */}
        <Route element={<AdminLayout />}>
          <Route
            path="/admin"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <AdminDefaultRedirect />
              </ProtectedPage>
            }
          />
          <Route
            path="/selection"
            element={
              <PageWrap>
                <SelectionPage />
              </PageWrap>
            }
          />
          <Route
            path="/thread-size"
            element={
              <PageWrap>
                <ThreadSizeToolPage />
              </PageWrap>
            }
          />
          <Route
            path="/product-wall"
            element={
              <PageWrap>
                <ProductWallPage />
              </PageWrap>
            }
          />
          <Route
            path="/projects"
            element={
              <ProtectedPage>
                <ProjectsPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/projects/:id"
            element={
              <ProtectedPage>
                <ProjectDetailPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/downloads"
            element={
              <ProtectedPage>
                <DownloadsPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/favorites"
            element={
              <ProtectedPage>
                <FavoritesPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/my-shares"
            element={
              <ProtectedPage>
                <MySharesPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedPage>
                <ProfilePage />
              </ProtectedPage>
            }
          />
          <Route
            path="/support"
            element={
              <ProtectedPage>
                <SupportPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/my-tickets"
            element={
              <ProtectedPage>
                <MyTicketsPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/my-tickets/:id"
            element={
              <ProtectedPage>
                <TicketDetailPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/categories"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <CategoryAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/models"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <ModelAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/tickets"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <TicketAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/tickets/:id"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <TicketDetailPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/settings/*"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <SettingsPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <UserAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <AuditLogPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/shares"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <ShareAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/downloads"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <DownloadAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/selections"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <SelectionAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/my-inquiries"
            element={
              <ProtectedPage>
                <MyInquiriesPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/my-inquiries/:id"
            element={
              <ProtectedPage>
                <InquiryDetailPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/inquiries"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <InquiryAdminPage />
              </ProtectedPage>
            }
          />
          <Route
            path="/admin/inquiries/:id"
            element={
              <ProtectedPage requiredRole="ADMIN">
                <InquiryDetailPage />
              </ProtectedPage>
            }
          />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MaintenanceGate>
  );
}
