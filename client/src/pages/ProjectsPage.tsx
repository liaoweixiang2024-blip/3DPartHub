import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { projectApi, type Project } from '../api/projects';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { PageHeader } from '../components/shared/PagePrimitives';
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { bottomSheetMotion, dialogPanelMotion, listItemMotion, overlayMotion } from '../lib/motion';
import { useAuthStore } from '../stores';

function ProjectsLoadingGrid() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[320px]">
      <PageRefreshIndicator label={t('projects.loading')} />
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
  const { i18n, t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirming) {
      onDelete(project.id);
    } else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  return (
    <div className="relative group">
      <Link
        to={`/projects/${project.id}`}
        className="block bg-surface-container-high rounded-lg overflow-hidden border border-outline-variant/10 transition-[border-color,box-shadow] duration-200 ease-out hover:border-primary/30 hover:shadow-card"
      >
        <div className="h-32 bg-surface-container-lowest flex items-center justify-center relative">
          <Icon name="folder" size={48} className="text-on-surface-variant/20" />
          <span className="absolute top-3 right-3 text-[10px] bg-primary/20 px-2 py-0.5 rounded-sm text-primary font-medium">
            {t('projects.modelCount', { count: project._count.models })}
          </span>
        </div>
        <div className="p-4">
          <h3 className="text-base font-headline text-on-surface mb-1 line-clamp-2 break-words">{project.name}</h3>
          {project.description && (
            <p className="text-xs text-on-surface-variant line-clamp-2 break-words">{project.description}</p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[10px] text-on-surface-variant">
              {t('projects.memberCount', { count: project.members.length })}
            </span>
            <span className="text-on-surface-variant/30">·</span>
            <span className="text-[10px] text-on-surface-variant">
              {new Date(project.updatedAt).toLocaleDateString(i18n.language)}
            </span>
          </div>
        </div>
      </Link>
      <button
        onClick={handleDelete}
        className={`absolute top-2 left-2 p-1.5 rounded-sm transition-[background-color,color,opacity] duration-150 ease-out z-10 ${
          confirming
            ? 'bg-error text-on-error'
            : 'bg-surface-container-high/80 text-on-surface-variant opacity-0 group-hover:opacity-100 hover:text-error'
        }`}
        title={confirming ? t('projects.confirmDelete') : t('projects.deleteProject')}
      >
        <Icon name={confirming ? 'delete' : 'delete_outline'} size={16} />
      </button>
    </div>
  );
}

export default function ProjectsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('projects.title'));
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [loginDialogOpen, setLoginDialogOpen] = useState(!isAuthenticated);
  const [newDesc, setNewDesc] = useState('');

  const { data: projects, mutate } = useSWR(isAuthenticated ? '/projects' : null, () => projectApi.list());
  const projectList = projects || [];
  const {
    visibleItems: visibleProjects,
    hasMore,
    loadMore,
  } = useVisibleItems(projectList, 60, String(projectList.length));
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await projectApi.create({ name: newName.trim(), description: newDesc.trim() || undefined });
      mutate();
      setShowCreate(false);
      setNewName('');
      setNewDesc('');
      toast(t('projects.created'), 'success');
    } catch {
      toast(t('projects.createFailed'), 'error');
    }
  };

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await projectApi.delete(id);
        mutate();
        toast(t('projects.deleted'), 'success');
      } catch {
        toast(t('projects.deleteFailed'), 'error');
      }
    },
    [mutate, t, toast],
  );

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="lock" size={64} className="text-on-surface-variant/30" />
        <p className="text-on-surface-variant">{t('projects.loginRequired')}</p>
        <button onClick={() => setLoginDialogOpen(true)} className="text-primary hover:underline">
          {t('projects.login')}
        </button>
        <LoginConfirmDialog
          open={loginDialogOpen}
          onClose={() => setLoginDialogOpen(false)}
          reason={t('projects.loginReason')}
        />
      </div>
    );
  }

  return (
    <AdminPageShell mobileContentClassName="p-4 pb-20">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6 border-b border-surface-container-low pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm mb-2 overflow-x-auto scrollbar-hidden">
              <Link to="/" className="text-on-surface-variant hover:text-on-surface">
                {t('projects.home')}
              </Link>
              <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
              <span className="text-primary font-medium">{t('projects.projectSpace')}</span>
            </div>
            <PageHeader title={t('projects.title')} />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 flex items-center gap-2"
          >
            <Icon name="add" size={20} />
            {t('projects.createProject')}
          </button>
        </div>

        {!projects ? (
          <ProjectsLoadingGrid />
        ) : projectList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Icon name="folder_off" size={56} className="text-on-surface-variant/30" />
            <p className="text-on-surface-variant">{t('projects.noProjects')}</p>
            <button onClick={() => setShowCreate(true)} className="text-primary hover:underline text-sm">
              {t('projects.createFirst')}
            </button>
          </div>
        ) : (
          <>
            <div className={`grid gap-4 ${isDesktop ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
              {visibleProjects.map((p) => (
                <motion.div key={p.id} variants={listItemMotion} initial="initial" animate="animate">
                  <ProjectCard project={p} onDelete={handleDelete} />
                </motion.div>
              ))}
            </div>
            <InfiniteLoadTrigger hasMore={hasMore} isLoading={false} onLoadMore={loadMore} />
          </>
        )}
      </div>

      {/* Create project modal */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            variants={overlayMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              variants={isDesktop ? dialogPanelMotion : bottomSheetMotion}
              initial="initial"
              animate="animate"
              exit="exit"
              className="bg-surface-container-low rounded-t-lg sm:rounded-lg w-full max-w-md p-4 sm:p-6 shadow-2xl border border-outline-variant/20 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-headline font-bold text-on-surface mb-4">{t('projects.createProject')}</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-on-surface-variant mb-1">{t('projects.nameRequired')}</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary"
                    placeholder={t('projects.namePlaceholder')}
                  />
                </div>
                <div>
                  <label className="block text-xs text-on-surface-variant mb-1">{t('projects.description')}</label>
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary resize-none h-20"
                    placeholder={t('projects.projectDescriptionPlaceholder')}
                  />
                </div>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {t('projects.create')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdminPageShell>
  );
}
