import { lazy, Suspense } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import ProtectedRoute from "./components/shared/ProtectedRoute";
import Icon from "./components/shared/Icon";
import { getSiteTitle, getSiteIcon } from "./lib/publicSettings";

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

function NotFoundPage() {
  const siteIcon = getSiteIcon();
  const siteTitle = getSiteTitle();
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-surface gap-4">
      <div className="flex items-center gap-2 mb-2">
        {siteIcon ? (
          <img src={siteIcon} alt={siteTitle} className="h-8 w-8 shrink-0 object-contain" />
        ) : (
          <Icon name="view_in_ar" size={32} className="text-primary-container shrink-0" />
        )}
        <span className="text-lg font-headline font-bold tracking-tight text-on-surface">{siteTitle}</span>
      </div>
      <Icon name="search_off" size={56} className="text-on-surface-variant/50" />
      <h1 className="text-2xl font-headline font-bold text-on-surface">页面不存在</h1>
      <p className="text-sm text-on-surface-variant">您访问的页面可能已被移除或暂时不可用</p>
      <Link to="/" className="text-primary-container hover:underline mt-2">返回首页</Link>
    </div>
  );
}

export default function Router() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<PageWrap><LoginPage /></PageWrap>} />
        <Route path="/legal/:type" element={<PageWrap><LegalPage /></PageWrap>} />
        <Route path="/share/:token" element={<PageWrap><SharePage /></PageWrap>} />
        <Route path="/" element={<PageWrap><HomePage /></PageWrap>} />
        <Route path="/model/:id" element={<PageWrap><ModelDetailPage /></PageWrap>} />
        <Route path="/projects" element={<PageWrap><ProtectedRoute><ProjectsPage /></ProtectedRoute></PageWrap>} />
        <Route path="/projects/:id" element={<PageWrap><ProtectedRoute><ProjectDetailPage /></ProtectedRoute></PageWrap>} />
        <Route path="/downloads" element={<PageWrap><ProtectedRoute><DownloadsPage /></ProtectedRoute></PageWrap>} />
        <Route path="/favorites" element={<PageWrap><ProtectedRoute><FavoritesPage /></ProtectedRoute></PageWrap>} />
        <Route path="/profile" element={<PageWrap><ProtectedRoute><ProfilePage /></ProtectedRoute></PageWrap>} />
        <Route path="/support" element={<PageWrap><ProtectedRoute><SupportPage /></ProtectedRoute></PageWrap>} />
        <Route path="/my-tickets" element={<PageWrap><ProtectedRoute><MyTicketsPage /></ProtectedRoute></PageWrap>} />
        <Route path="/my-tickets/:id" element={<PageWrap><ProtectedRoute><TicketDetailPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/categories" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><CategoryAdminPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/models" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><ModelAdminPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/tickets" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><TicketAdminPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/tickets/:id" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><TicketDetailPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/settings" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><SettingsPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/users" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><UserAdminPage /></ProtectedRoute></PageWrap>} />
        <Route path="/admin/audit" element={<PageWrap><ProtectedRoute requiredRole="ADMIN"><AuditLogPage /></ProtectedRoute></PageWrap>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AnimatePresence>
  );
}
