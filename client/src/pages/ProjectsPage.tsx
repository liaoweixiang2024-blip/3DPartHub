import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import useSWR from 'swr';
import { projectApi, type Project } from '../api/projects';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { isLoginDialogEnabled } from '../components/shared/ProtectedLink';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { PageHeader } from '../components/shared/PagePrimitives';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useAuthStore } from '../stores';

function ProjectCard({ project, onDelete }: { project: Project; onDelete: (id: string) => void }) {
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
        className="block bg-surface-container-high rounded-lg overflow-hidden hover:shadow-[0_12px_24px_rgba(0,0,0,0.4)] transition-all duration-300 border border-outline-variant/10 hover:border-primary/30"
      >
        <div className="h-32 bg-surface-container-lowest flex items-center justify-center relative">
          <Icon name="folder" size={48} className="text-on-surface-variant/20" />
          <span className="absolute top-3 right-3 text-[10px] bg-primary/20 px-2 py-0.5 rounded-sm text-primary font-medium">
            {project._count.models} 个模型
          </span>
        </div>
        <div className="p-4">
          <h3 className="text-base font-headline text-on-surface mb-1 line-clamp-2 break-words">{project.name}</h3>
          {project.description && (
            <p className="text-xs text-on-surface-variant line-clamp-2 break-words">{project.description}</p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <span className="text-[10px] text-on-surface-variant">{project.members.length} 成员</span>
            <span className="text-on-surface-variant/30">·</span>
            <span className="text-[10px] text-on-surface-variant">
              {new Date(project.updatedAt).toLocaleDateString('zh-CN')}
            </span>
          </div>
        </div>
      </Link>
      <button
        onClick={handleDelete}
        className={`absolute top-2 left-2 p-1.5 rounded-sm transition-all z-10 ${
          confirming
            ? 'bg-error text-on-error'
            : 'bg-surface-container-high/80 text-on-surface-variant opacity-0 group-hover:opacity-100 hover:text-error'
        }`}
        title={confirming ? '确认删除' : '删除项目'}
      >
        <Icon name={confirming ? 'delete' : 'delete_outline'} size={16} />
      </button>
    </div>
  );
}

export default function ProjectsPage() {
  useDocumentTitle('项目');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { isAuthenticated } = useAuthStore();
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
      toast('项目已创建', 'success');
    } catch {
      toast('创建失败', 'error');
    }
  };

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await projectApi.delete(id);
        mutate();
        toast('项目已删除', 'success');
      } catch {
        toast('删除失败', 'error');
      }
    },
    [mutate, toast],
  );

  if (!isAuthenticated) {
    if (!isLoginDialogEnabled()) {
      return <Navigate to="/login" state={{ from: '/projects' }} replace />;
    }
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="lock" size={64} className="text-on-surface-variant/30" />
        <p className="text-on-surface-variant">请先登录查看项目</p>
        <button onClick={() => setLoginDialogOpen(true)} className="text-primary hover:underline">
          前往登录
        </button>
        <LoginConfirmDialog open={loginDialogOpen} onClose={() => setLoginDialogOpen(false)} reason="查看项目" />
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
                首页
              </Link>
              <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
              <span className="text-primary font-medium">项目空间</span>
            </div>
            <PageHeader title="项目" />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 flex items-center gap-2"
          >
            <Icon name="add" size={20} />
            新建项目
          </button>
        </div>

        {!projects ? (
          <div className="flex items-center justify-center py-20">
            <Icon name="progress_activity" size={48} className="text-on-surface-variant/30 animate-pulse" />
          </div>
        ) : projectList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Icon name="folder_off" size={56} className="text-on-surface-variant/30" />
            <p className="text-on-surface-variant">还没有项目</p>
            <button onClick={() => setShowCreate(true)} className="text-primary hover:underline text-sm">
              创建第一个项目
            </button>
          </div>
        ) : (
          <>
            <div className={`grid gap-4 ${isDesktop ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
              {visibleProjects.map((p) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setShowCreate(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-surface-container-low rounded-t-lg sm:rounded-lg w-full max-w-md p-4 sm:p-6 shadow-2xl border border-outline-variant/20 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-headline font-bold text-on-surface mb-4">新建项目</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-on-surface-variant mb-1">项目名称 *</label>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary"
                    placeholder="输入项目名称"
                  />
                </div>
                <div>
                  <label className="block text-xs text-on-surface-variant mb-1">描述</label>
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary resize-none h-20"
                    placeholder="项目描述（可选）"
                  />
                </div>
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim()}
                    className="bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    创建
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
