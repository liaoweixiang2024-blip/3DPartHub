import { lazy, Suspense, useEffect, useRef } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "./stores/useAuthStore";

import Icon from "./components/shared/Icon";
import BrandMark from "./components/shared/BrandMark";
import MaintenanceGate from "./components/shared/MaintenanceGate";
import { isModelDetailPath, saveModelReturnPath } from "./lib/modelReturnPath";

// Static import for the landing page — eliminates flash on first visit
import HomePage from "./pages/HomePage";

// Lazy-loaded pages — Vite generates separate chunks automatically
const ModelDetailPage = lazy(() => import("./pages/ModelDetailPage"));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const SupportPage = lazy(() => import("./pages/SupportPage"));
const MyTicketsPage = lazy(() => import("./pages/MyTicketsPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const SharePage = lazy(() => import("./pages/SharePage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const CategoryAdminPage = lazy(() => import("./pages/CategoryAdminPage"));
const ModelAdminPage = lazy(() => import("./pages/ModelAdminPage"));
const TicketAdminPage = lazy(() => import("./pages/TicketAdminPage"));
const TicketDetailPage = lazy(() => import("./pages/TicketDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const UserAdminPage = lazy(() => import("./pages/UserAdminPage"));
const AuditLogPage = lazy(() => import("./pages/AuditLogPage"));
const ShareAdminPage = lazy(() => import("./pages/ShareAdminPage"));
const DownloadAdminPage = lazy(() => import("./pages/DownloadAdminPage"));
const SelectionPage = lazy(() => import("./pages/SelectionPage"));
const ThreadSizeToolPage = lazy(() => import("./pages/ThreadSizeToolPage"));
const ProductWallPage = lazy(() => import("./pages/ProductWallPage"));
const SelectionAdminPage = lazy(() => import("./pages/SelectionAdminPage"));
const MyInquiriesPage = lazy(() => import("./pages/MyInquiriesPage"));
const InquiryDetailPage = lazy(() => import("./pages/InquiryDetailPage"));
const InquiryAdminPage = lazy(() => import("./pages/InquiryAdminPage"));
const SelectionSharePage = lazy(() => import("./pages/SelectionSharePage"));

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

function PageWrap({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="h-full"
      >
        {children}
      </motion.div>
    </Suspense>
  );
}

// Protected pages — check auth BEFORE entering motion animation
// so redirect to login is instant (no exit animation delay)
function ProtectedPage({ children, requiredRole }: { children: React.ReactNode; requiredRole?: string }) {
  const { isAuthenticated, user, hasHydrated } = useAuthStore();
  const location = useLocation();

  if (!hasHydrated) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (requiredRole && user?.role !== requiredRole) {
    return <Navigate to="/" replace />;
  }

  return (
    <Suspense fallback={null}>
      <motion.div
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="h-full"
      >
        {children}
      </motion.div>
    </Suspense>
  );
}

// No wrapper — let the page handle its own height/scrolling
function ScrollPage({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      {children}
    </Suspense>
  );
}

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface gap-4">
      <BrandMark size="nav" centered className="mb-2" />
      <Icon name="search_off" size={56} className="text-on-surface-variant/50" />
      <h1 className="text-2xl font-headline font-bold text-on-surface">页面不存在</h1>
      <p className="text-sm text-on-surface-variant">您访问的页面可能已被移除或暂时不可用</p>
      <Link to="/" className="text-primary-container hover:underline mt-2">返回首页</Link>
    </div>
  );
}

function ModelReturnPathTracker() {
  const location = useLocation();

  useEffect(() => {
    if (isModelDetailPath(location.pathname) || location.pathname === "/login") return;
    saveModelReturnPath(`${location.pathname}${location.search}${location.hash}`);
  }, [location.hash, location.pathname, location.search]);

  return null;
}

/** Periodically check token validity and logout if expired */
function useTokenWatcher() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const checkAndRefreshToken = useAuthStore((s) => s.checkAndRefreshToken);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return;

    // Check immediately on mount / auth change
    checkAndRefreshToken();

    // Then check every 60 seconds
    timerRef.current = setInterval(() => {
      checkAndRefreshToken();
    }, 60_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [hasHydrated, isAuthenticated, checkAndRefreshToken]);
}

export default function Router() {
  const location = useLocation();
  useTokenWatcher();

  return (
    <MaintenanceGate>
      <ModelReturnPathTracker />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/login" element={<ScrollPage><LoginPage /></ScrollPage>} />
          <Route path="/legal/:type" element={<ScrollPage><LegalPage /></ScrollPage>} />
          <Route path="/share/:token" element={<ScrollPage><SharePage /></ScrollPage>} />
          <Route path="/selection/s/:token" element={<ScrollPage><SelectionSharePage /></ScrollPage>} />
          <Route path="/" element={<PageWrap><HomePage /></PageWrap>} />
          <Route path="/model/:id" element={<PageWrap><ModelDetailPage /></PageWrap>} />
          <Route path="/projects" element={<ProtectedPage><ProjectsPage /></ProtectedPage>} />
          <Route path="/projects/:id" element={<ProtectedPage><ProjectDetailPage /></ProtectedPage>} />
          <Route path="/downloads" element={<ProtectedPage><DownloadsPage /></ProtectedPage>} />
          <Route path="/favorites" element={<ProtectedPage><FavoritesPage /></ProtectedPage>} />
          <Route path="/profile" element={<ProtectedPage><ProfilePage /></ProtectedPage>} />
          <Route path="/support" element={<ProtectedPage><SupportPage /></ProtectedPage>} />
          <Route path="/my-tickets" element={<ProtectedPage><MyTicketsPage /></ProtectedPage>} />
          <Route path="/my-tickets/:id" element={<ProtectedPage><TicketDetailPage /></ProtectedPage>} />
          <Route path="/admin/categories" element={<ProtectedPage requiredRole="ADMIN"><CategoryAdminPage /></ProtectedPage>} />
          <Route path="/admin/models" element={<ProtectedPage requiredRole="ADMIN"><ModelAdminPage /></ProtectedPage>} />
          <Route path="/admin/tickets" element={<ProtectedPage requiredRole="ADMIN"><TicketAdminPage /></ProtectedPage>} />
          <Route path="/admin/tickets/:id" element={<ProtectedPage requiredRole="ADMIN"><TicketDetailPage /></ProtectedPage>} />
          <Route path="/admin/settings" element={<ProtectedPage requiredRole="ADMIN"><SettingsPage /></ProtectedPage>} />
          <Route path="/admin/users" element={<ProtectedPage requiredRole="ADMIN"><UserAdminPage /></ProtectedPage>} />
          <Route path="/admin/audit" element={<ProtectedPage requiredRole="ADMIN"><AuditLogPage /></ProtectedPage>} />
          <Route path="/admin/shares" element={<ProtectedPage requiredRole="ADMIN"><ShareAdminPage /></ProtectedPage>} />
          <Route path="/admin/downloads" element={<ProtectedPage requiredRole="ADMIN"><DownloadAdminPage /></ProtectedPage>} />
          <Route path="/selection" element={<PageWrap><SelectionPage /></PageWrap>} />
          <Route path="/tools/thread-size" element={<ProtectedPage><ThreadSizeToolPage /></ProtectedPage>} />
          <Route path="/product-wall" element={<PageWrap><ProductWallPage /></PageWrap>} />
          <Route path="/admin/selections" element={<ProtectedPage requiredRole="ADMIN"><SelectionAdminPage /></ProtectedPage>} />
          <Route path="/my-inquiries" element={<ProtectedPage><MyInquiriesPage /></ProtectedPage>} />
          <Route path="/my-inquiries/:id" element={<ProtectedPage><InquiryDetailPage /></ProtectedPage>} />
          <Route path="/admin/inquiries" element={<ProtectedPage requiredRole="ADMIN"><InquiryAdminPage /></ProtectedPage>} />
          <Route path="/admin/inquiries/:id" element={<ProtectedPage requiredRole="ADMIN"><InquiryDetailPage /></ProtectedPage>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AnimatePresence>
    </MaintenanceGate>
  );
}
