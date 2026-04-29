import { useState, memo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { PageHeader, PageTitle } from "../components/shared/PagePrimitives";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { projectApi, type Project, type ProjectModel } from "../api/projects";
import { useAuthStore } from "../stores";
import { useToast } from "../components/shared/Toast";
import FormatTag from "../components/shared/FormatTag";
import Icon from "../components/shared/Icon";
import ModelThumbnail from "../components/shared/ModelThumbnail";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ModelRow = memo(function ModelRow({ model }: { model: ProjectModel }) {
  return (
    <Link
      to={`/model/${model.id}`}
      className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-surface-container-high rounded-sm hover:bg-surface-container-highest transition-colors border border-outline-variant/10"
    >
      <div className="w-16 h-16 bg-surface-container-lowest rounded-sm shrink-0 overflow-hidden">
        <ModelThumbnail src={model.thumbnailUrl} alt="" className="w-full h-full object-cover rounded-sm" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-headline text-on-surface line-clamp-2 break-words">{model.name || model.originalName}</h3>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <FormatTag format={model.format?.toUpperCase() || "?"} />
          <span className="text-[10px] text-on-surface-variant">{formatFileSize(model.gltfSize || 0)}</span>
        </div>
      </div>
      <Icon name="chevron_right" size={20} className="text-on-surface-variant" />
    </Link>
  );
});

function EditModal({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(project.name);
  const [desc, setDesc] = useState(project.description || "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await projectApi.update(project.id, { name: name.trim(), description: desc.trim() || undefined });
      toast("项目已更新", "success");
      onSaved();
      onClose();
    } catch {
      toast("更新失败", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-surface-container-low rounded-t-lg sm:rounded-lg w-full max-w-md p-4 sm:p-6 shadow-2xl border border-outline-variant/20 max-h-[calc(100dvh-1.5rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-headline font-bold text-on-surface mb-4">编辑项目</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">项目名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">描述</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary resize-none h-20"
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface">取消</button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  useDocumentTitle("项目详情");
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [showEdit, setShowEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const { toast } = useToast();

  const { data: project, error, mutate } = useSWR(
    id ? `/projects/${id}` : null,
    () => projectApi.getById(id!)
  );

  const isOwner = project && user && project.ownerId === user.id;

  const handleDelete = async () => {
    if (!project) return;
    try {
      await projectApi.delete(project.id);
      toast("项目已删除", "success");
      navigate("/projects");
    } catch {
      toast("删除失败", "error");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!id) return;
    try {
      await projectApi.removeMember(id, userId);
      mutate();
      toast("成员已移除", "success");
    } catch {
      toast("移除失败", "error");
    }
  };

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh bg-surface gap-4">
        <Icon name="search_off" size={64} className="text-on-surface-variant" />
        <PageTitle>
          {error ? "加载失败" : "加载中..."}
        </PageTitle>
        <Link to="/projects" className="text-primary hover:underline">返回项目列表</Link>
      </div>
    );
  }

  return (
    <AdminPageShell mobileContentClassName="p-4 pb-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 text-sm mb-4 overflow-x-auto scrollbar-hidden">
            <Link to="/" className="text-on-surface-variant hover:text-on-surface shrink-0">首页</Link>
            <Icon name="chevron_right" size={12} className="text-on-surface-variant/40 shrink-0" />
            <Link to="/projects" className="text-on-surface-variant hover:text-on-surface shrink-0">项目</Link>
            <Icon name="chevron_right" size={12} className="text-on-surface-variant/40 shrink-0" />
            <span className="text-primary font-medium truncate">{project.name}</span>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6 border-b border-surface-container-low pb-4">
            <div className="min-w-0">
              <PageHeader title={project.name} description={project.description} />
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-3">
              <div className="text-xs text-on-surface-variant text-right">
                <div>{project._count.models} 个模型</div>
                <div>{project.members.length} 个成员</div>
              </div>
              {isOwner && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setShowEdit(true)}
                    className="p-2 text-on-surface-variant hover:text-primary transition-colors rounded-sm hover:bg-surface-container-high"
                    title="编辑项目"
                  >
                    <Icon name="edit" size={18} />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="p-2 text-on-surface-variant hover:text-error transition-colors rounded-sm hover:bg-surface-container-high"
                    title="删除项目"
                  >
                    <Icon name="delete_outline" size={18} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Delete confirmation */}
          <AnimatePresence>
            {deleteConfirm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 bg-error/10 border border-error/30 rounded-sm p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between overflow-hidden"
              >
                <p className="text-sm text-on-surface">确认删除此项目？此操作不可撤销。</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteConfirm(false)} className="px-3 py-1.5 text-xs text-on-surface-variant">取消</button>
                  <button onClick={handleDelete} className="px-3 py-1.5 text-xs bg-error text-on-error rounded-sm">确认删除</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Members */}
          <div className="mb-6">
            <h2 className="text-xs uppercase tracking-widest text-on-surface-variant font-medium mb-3">成员</h2>
            <div className="flex flex-wrap gap-2">
              {project.members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 bg-surface-container-high px-3 py-1.5 rounded-sm border border-outline-variant/10 group">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] text-primary font-bold">
                    {(m.user.username || "?")[0].toUpperCase()}
                  </div>
                  <span className="text-xs text-on-surface break-words">{m.user.username}</span>
                  <span className="text-[9px] text-on-surface-variant bg-surface-container-lowest px-1.5 py-0.5 rounded-sm">
                    {m.role}
                  </span>
                  {isOwner && m.userId !== user?.id && (
                    <button
                      onClick={() => handleRemoveMember(m.userId)}
                      className="text-on-surface-variant/30 hover:text-error transition-colors ml-1 opacity-0 group-hover:opacity-100"
                      title="移除成员"
                    >
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Models */}
          <div>
            <h2 className="text-xs uppercase tracking-widest text-on-surface-variant font-medium mb-3">模型列表</h2>
            {project.models && project.models.length > 0 ? (
              <div className="flex flex-col gap-2">
                {project.models.map((model) => (
                  <motion.div
                    key={model.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ModelRow model={model} />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Icon name="view_in_ar" size={48} className="text-on-surface-variant/20" />
                <p className="text-sm text-on-surface-variant">项目中还没有模型</p>
              </div>
            )}
          </div>
        </div>

      <AnimatePresence>
        {showEdit && project && (
          <EditModal project={project} onClose={() => setShowEdit(false)} onSaved={() => mutate()} />
        )}
      </AnimatePresence>
    </AdminPageShell>
  );
}
