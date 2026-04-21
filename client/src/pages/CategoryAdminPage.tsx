import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import useSWR from "swr";
import { useMediaQuery } from "../layouts/hooks/useMediaQuery";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import TopNav from "../components/shared/TopNav";
import BottomNav from "../components/shared/BottomNav";
import AppSidebar from "../components/shared/Sidebar";
import MobileNavDrawer from "../components/shared/MobileNavDrawer";
import Icon from "../components/shared/Icon";
import { categoriesApi, type CategoryItem } from "../api/categories";
import { useToast } from "../components/shared/Toast";

function CategoryRow({
  cat,
  depth = 0,
  onEdit,
  onDelete,
}: {
  cat: CategoryItem;
  depth?: number;
  onEdit: (cat: CategoryItem) => void;
  onDelete: (cat: CategoryItem) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-high transition-colors border-b border-outline-variant/10">
        <span style={{ paddingLeft: depth * 24 }} />
        {cat.children?.length ? (
          <Icon name="folder" size={18} className="text-primary shrink-0" />
        ) : (
          <Icon name="view_in_ar" size={18} className="text-on-surface-variant shrink-0" />
        )}
        <Icon name={cat.icon || "folder"} size={18} className="text-on-surface-variant shrink-0" />
        <span className="flex-1 text-sm text-on-surface truncate">{cat.name}</span>
        {cat.children?.length ? (
          <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-2 py-0.5 rounded-sm">
            {cat.children.length} 子类
          </span>
        ) : null}
        <span className="text-[10px] text-on-surface-variant font-mono">排序: {cat.sortOrder}</span>
        <button onClick={() => onEdit(cat)} className="p-1.5 text-on-surface-variant hover:text-primary transition-colors" aria-label="编辑">
          <Icon name="settings" size={16} />
        </button>
        <button onClick={() => onDelete(cat)} className="p-1.5 text-on-surface-variant hover:text-error transition-colors" aria-label="删除">
          <Icon name="close" size={16} />
        </button>
      </div>
      {cat.children?.map((child) => (
        <CategoryRow key={child.id} cat={child} depth={depth + 1} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </>
  );
}

function CategoryModal({
  category,
  parentId,
  onClose,
  onSaved,
}: {
  category?: CategoryItem | null;
  parentId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name || "");
  const [icon, setIcon] = useState(category?.icon || "folder");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isEdit = !!category;

  const handleSave = async () => {
    if (!name.trim()) {
      toast("请输入分类名称", "error");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await categoriesApi.update(category!.id, { name: name.trim(), icon });
      } else {
        await categoriesApi.create({ name: name.trim(), icon, parentId: parentId || null });
      }
      toast(isEdit ? "分类已更新" : "分类已创建", "success");
      onSaved();
      onClose();
    } catch {
      toast("操作失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const iconOptions = [
    "folder", "stainless_steel", "iron_hydraulic", "copper", "pneumatic",
    "assembly", "valve", "accessories", "universal_pipe", "air_tank",
    "pneumatic_fitting", "lubrication", "pipeline", "other_materials",
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-surface-container-low rounded-lg w-full max-w-md mx-4 p-6 shadow-2xl border border-outline-variant/20"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-headline font-bold text-on-surface mb-4">
          {isEdit ? "编辑分类" : parentId ? "添加子分类" : "添加分类"}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">分类名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-container-lowest text-on-surface rounded-sm px-3 py-2 border border-outline-variant/30 outline-none focus:border-primary"
              placeholder="输入分类名称"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-on-surface-variant mb-1">图标</label>
            <div className="grid grid-cols-7 gap-1.5">
              {iconOptions.map((ic) => (
                <button
                  key={ic}
                  onClick={() => setIcon(ic)}
                  className={`p-2 rounded-sm flex items-center justify-center transition-colors ${
                    icon === ic ? "bg-primary-container/20 border border-primary" : "bg-surface-container-lowest border border-outline-variant/10 hover:border-outline"
                  }`}
                  title={ic}
                >
                  <Icon name={ic} size={18} className={icon === ic ? "text-primary" : "text-on-surface-variant"} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 justify-end">
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

function Content() {
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryItem | null>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: catData, mutate } = useSWR("/categories", () => categoriesApi.tree());
  const tree = catData?.items;

  const handleEdit = (cat: CategoryItem) => {
    setEditingCat(cat);
    setAddParentId(null);
    setShowModal(true);
  };

  const handleAddChild = (parentId: string) => {
    setEditingCat(null);
    setAddParentId(parentId);
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await categoriesApi.delete(id);
      toast("分类已删除", "success");
      mutate();
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "删除失败";
      toast(msg, "error");
    }
    setDeleteConfirm(null);
  };

  const handleAdd = () => {
    setEditingCat(null);
    setAddParentId(null);
    setShowModal(true);
  };

  return (
    <>
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="font-headline text-lg md:text-2xl font-bold tracking-tight text-on-surface uppercase">分类管理</h2>
          <p className="text-on-secondary-container mt-1 text-sm">共 {tree?.length || 0} 个一级分类</p>
        </div>
        <button
          onClick={handleAdd}
          className="bg-primary-container text-on-primary rounded-sm px-4 py-2 text-sm font-medium hover:opacity-90 flex items-center gap-2"
        >
          <Icon name="add" size={18} />
          添加分类
        </button>
      </div>

      {!tree ? (
        <div className="flex items-center justify-center py-20">
          <Icon name="progress_activity" size={32} className="text-on-surface-variant animate-spin" />
        </div>
      ) : (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
          {tree.map((cat) => (
            <div key={cat.id}>
              <CategoryRow cat={cat} onEdit={handleEdit} onDelete={(c) => setDeleteConfirm(c.id)} />
              {cat.children && (
                <div style={{ paddingLeft: 24 }} className="px-4 py-2 border-b border-outline-variant/10">
                  <button
                    onClick={() => handleAddChild(cat.id)}
                    className="text-xs text-primary hover:text-primary-container flex items-center gap-1"
                  >
                    <Icon name="add" size={14} />
                    添加子分类
                  </button>
                </div>
              )}
            </div>
          ))}
          {tree.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Icon name="folder_off" size={48} className="text-on-surface-variant/20" />
              <p className="text-sm text-on-surface-variant">暂无分类</p>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <CategoryModal
            category={editingCat}
            parentId={addParentId}
            onClose={() => { setShowModal(false); setEditingCat(null); }}
            onSaved={() => mutate()}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-surface-container-low rounded-lg p-6 max-w-sm mx-4 shadow-2xl border border-outline-variant/20"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-bold text-on-surface mb-2">确认删除</h3>
              <p className="text-sm text-on-surface-variant mb-4">删除后不可恢复，确定要删除此分类吗？</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-on-surface-variant">取消</button>
                <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm bg-error text-on-error rounded-sm">确认删除</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function CategoryAdminPage() {
  useDocumentTitle("分类管理");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <Content />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-surface">
      <TopNav compact onMenuToggle={() => setNavOpen((prev) => !prev)} />
      <MobileNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 overflow-y-auto scrollbar-hidden bg-surface-dim">
        <div className="px-4 py-4 pb-20">
          <Content />
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
