import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { SkeletonList } from '../components/shared/Skeleton';
import TopNav from '../components/shared/TopNav';
import BottomNav from '../components/shared/BottomNav';
import AppSidebar from '../components/shared/Sidebar';
import MobileNavDrawer from '../components/shared/MobileNavDrawer';
import Icon from '../components/shared/Icon';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import { useToast } from '../components/shared/Toast';
import { modelApi, type ServerModelListItem } from '../api/models';
import { categoriesApi, type CategoryItem } from '../api/categories';
import CategorySelect from '../components/shared/CategorySelect';
import useSWR from 'swr';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EditDialog({ open, model, categories, onClose, onSaved }: {
  open: boolean; model: ServerModelListItem | null; categories: CategoryItem[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [drawingUploading, setDrawingUploading] = useState(false);
  const [drawingUrl, setDrawingUrl] = useState<string | null>(null);
  const [fileReplacing, setFileReplacing] = useState(false);

  useEffect(() => {
    if (model) {
      setName(model.name || '');
      setDescription('');
      setCategoryId(model.category_id || '');
      setThumbnailUrl(model.thumbnail_url);
      setDrawingUrl(model.drawing_url || null);
    }
  }, [model]);

  if (!open || !model) return null;

  const handleSave = async () => {
    if (!name.trim()) { toast('名称不能为空', 'error'); return; }
    setSaving(true);
    let ok = false;
    try {
      await modelApi.update(model.model_id, { name: name.trim(), description: description.trim() || undefined, categoryId: categoryId || null });
      toast('保存成功', 'success');
      ok = true;
    } catch { toast('保存失败', 'error'); } finally { setSaving(false); }
    if (ok) { onSaved(); onClose(); }
  };

  const handleThumbnailUpload = async (file: File) => {
    setThumbnailUploading(true);
    let ok = false;
    try {
      const result = await modelApi.uploadThumbnail(model.model_id, file);
      setThumbnailUrl(result.thumbnail_url);
      toast('预览图已更新', 'success');
      ok = true;
    } catch { toast('上传预览图失败', 'error'); } finally { setThumbnailUploading(false); }
    if (ok) onSaved();
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    let ok = false;
    try {
      const result = await modelApi.reconvert(model.model_id);
      setThumbnailUrl(result.thumbnail_url);
      toast('预览图已重新生成', 'success');
      ok = true;
    } catch { toast('重新生成失败', 'error'); } finally { setRegenerating(false); }
    if (ok) onSaved();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm" onClick={onClose}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface">编辑模型</h3>
              <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface transition-colors"><Icon name="close" size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">预览图</label>
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                    <ModelThumbnail src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" id="thumb-upload" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleThumbnailUpload(f); e.target.value = ''; }} />
                    <button onClick={() => document.getElementById('thumb-upload')?.click()} disabled={thumbnailUploading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="upload" size={14} />{thumbnailUploading ? '上传中...' : '上传图片'}</button>
                    <button onClick={handleRegenerate} disabled={regenerating} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50"><Icon name="refresh" size={14} />{regenerating ? '生成中...' : '从模型重新生成'}</button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">名称</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">描述</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full bg-surface-container-lowest text-on-surface border border-outline-variant/30 focus:border-primary px-3 py-2 text-sm rounded-sm outline-none resize-none" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">分类</label>
                <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} placeholder="选择分类" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">产品图纸 (PDF)</label>
                <div className="flex items-center gap-3">
                  {drawingUrl ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Icon name="description" size={20} className="text-primary shrink-0" />
                      <span className="text-sm text-on-surface truncate flex-1">已上传</span>
                      <a href={drawingUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">查看</a>
                      <button onClick={async () => { let ok = false; try { await modelApi.deleteDrawing(model.model_id); setDrawingUrl(null); toast('图纸已删除', 'success'); ok = true; } catch { toast('删除失败', 'error'); } if (ok) onSaved(); }} className="text-xs text-error hover:underline">删除</button>
                    </div>
                  ) : (
                    <>
                      <input type="file" accept="application/pdf" className="hidden" id="drawing-upload" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.type !== 'application/pdf') { toast('仅支持 PDF 格式', 'error'); return; } setDrawingUploading(true); let ok = false; try { const r = await modelApi.uploadDrawing(model.model_id, f); setDrawingUrl(r.drawing_url); toast('图纸上传成功', 'success'); ok = true; } catch { toast('上传失败', 'error'); } finally { setDrawingUploading(false); } if (ok) onSaved(); e.target.value = ''; }} />
                      <button onClick={() => document.getElementById('drawing-upload')?.click()} disabled={drawingUploading} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center">
                        <Icon name="upload_file" size={14} />{drawingUploading ? '上传中...' : '上传 PDF 图纸'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="border-t border-outline-variant/20 pt-4 mt-1">
                <label className="text-xs uppercase tracking-wider text-on-surface-variant">替换模型文件</label>
                <p className="text-[10px] text-on-surface-variant/60 mt-1 mb-2">替换后将重新转换，预计耗时 30 秒</p>
                <input type="file" accept=".step,.stp,.iges,.igs,.xt,.x_t" className="hidden" id="replace-file-upload" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const ext = f.name.split('.').pop()?.toLowerCase() || '';
                  if (!['step','stp','iges','igs','xt','x_t'].includes(ext)) { toast('仅支持 STEP/IGES/XT 格式', 'error'); return; }
                  setFileReplacing(true);
                  try {
                    await modelApi.replaceFile(model.model_id, f);
                    toast('文件已上传，正在转换中...', 'success');
                  } catch { toast('替换文件失败', 'error'); }
                  finally { setFileReplacing(false); }
                  onSaved(); onClose();
                  e.target.value = '';
                }} />
                <button onClick={() => document.getElementById('replace-file-upload')?.click()} disabled={fileReplacing} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 disabled:opacity-50 w-full justify-center">
                  <Icon name="swap_horiz" size={14} />{fileReplacing ? '上传中...' : '选择新模型文件'}
                </button>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={onClose} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors">取消</button>
                <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-primary-container text-on-primary rounded-sm text-sm hover:bg-primary transition-colors disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DesktopContent() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editModel, setEditModel] = useState<ServerModelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerModelListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'models' | 'suggestions'>('models');

  const { data, isLoading, mutate } = useSWR(['/admin/models', search, page], () => modelApi.list({ search: search || undefined, page, pageSize: 20, grouped: false }));
  const { data: catData } = useSWR('/categories', () => categoriesApi.tree());
  const categories = catData?.items || [];

  // Merge suggestions
  const [sugPage, setSugPage] = useState(1);
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const { data: sugData, isLoading: sugLoading, mutate: sugMutate } = useSWR(
    activeTab === 'suggestions' ? ['/model-groups/suggestions', sugPage] : null,
    () => modelApi.getMergeSuggestions({ page: sugPage, pageSize: 15 })
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await modelApi.delete(deleteTarget.model_id); toast('已删除', 'success'); mutate(); setDeleteTarget(null); } catch { toast('删除失败', 'error'); } finally { setDeleting(false); }
  };

  const handleUpload = async (files: FileList) => {
    const accepted = Array.from(files).filter(f => { const ext = f.name.split('.').pop()?.toLowerCase() || ''; return ['step', 'stp', 'iges', 'igs', 'xt', 'x_t'].includes(ext); });
    if (accepted.length === 0) { toast('请选择 STEP/IGES/XT 格式的文件', 'error'); return; }
    setUploading(true);
    let ok = 0, fail = 0;
    // Upload with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    for (let i = 0; i < accepted.length; i += CONCURRENCY) {
      const batch = accepted.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(f => modelApi.upload(f)));
      for (const r of results) { if (r.status === "fulfilled") ok++; else fail++; }
    }
    setUploading(false);
    toast(`上传完成: ${ok} 成功${fail > 0 ? `, ${fail} 失败` : ''}`, fail > 0 ? 'error' : 'success');
    mutate();
  };

  const toggleSelect = (name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleMerge = async () => {
    if (selectedNames.size === 0) return;
    setMerging(true);
    try {
      const items = (sugData?.data || []).filter(s => selectedNames.has(s.name)).map(s => ({
        name: s.name,
        modelIds: s.models.map(m => m.id),
      }));
      const result = await modelApi.batchMerge(items);
      toast(`已合并 ${result.merged} 组`, 'success');
      setSelectedNames(new Set());
      sugMutate();
    } catch { toast('合并失败', 'error'); }
    finally { setMerging(false); }
  };

  return (
    <>
      <input type="file" multiple accept=".step,.stp,.iges,.igs,.xt,.x_t" className="hidden" id="admin-file-upload" onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface uppercase">模型管理</h2>
          <div className="flex rounded-sm border border-outline-variant/30 overflow-hidden">
            <button onClick={() => setActiveTab('models')} className={`px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === 'models' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'}`}>全部模型</button>
            <button onClick={() => { setActiveTab('suggestions'); sugMutate(); }} className={`px-4 py-1.5 text-sm font-medium transition-colors ${activeTab === 'suggestions' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'}`}>
              合并建议 {sugData?.total != null && <span className="ml-1 text-[10px] opacity-70">({sugData.total})</span>}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => document.getElementById('admin-file-upload')?.click()} disabled={uploading} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 transition-opacity active:scale-95 disabled:opacity-50">
            <Icon name="cloud_upload" size={18} />{uploading ? '上传中...' : '上传模型'}
          </button>
          <div className="flex items-center bg-surface-container-lowest rounded-sm px-3 py-2 border border-outline-variant/30">
            <Icon name="search" size={16} className="text-on-surface-variant mr-2" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="搜索模型..." className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-48" />
          </div>
        </div>
      </div>

      {activeTab === 'suggestions' ? (
        sugLoading ? <SkeletonList rows={5} /> : (
          <div className="space-y-3">
            {selectedNames.size > 0 && (
              <div className="flex items-center justify-between px-4 py-3 bg-primary-container/10 rounded-sm border border-primary/20">
                <span className="text-sm text-on-surface">已选择 <strong className="text-primary">{selectedNames.size}</strong> 组</span>
                <button onClick={handleMerge} disabled={merging} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-on-primary bg-primary-container rounded-sm hover:opacity-90 disabled:opacity-50">
                  <Icon name="merge" size={16} />{merging ? '合并中...' : `合并选中 (${selectedNames.size} 组)`}
                </button>
              </div>
            )}
            {sugData?.data.map((group) => (
              <div key={group.name} className="bg-surface-container-low rounded-sm border border-outline-variant/10 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <input type="checkbox" checked={selectedNames.has(group.name)} onChange={() => toggleSelect(group.name)} className="w-4 h-4 accent-primary-container rounded" />
                  <span className="text-sm font-medium text-on-surface flex-1">{group.name}</span>
                  <span className="text-[10px] bg-surface-container-highest px-2 py-0.5 rounded-sm text-on-surface-variant font-mono">{group.count} 个同名</span>
                </div>
                <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
                  {group.models.map(m => (
                    <div key={m.id} className="shrink-0 w-16">
                      <div className="w-16 h-16 rounded-sm bg-surface-container-highest overflow-hidden border border-outline-variant/10">
                        <ModelThumbnail src={m.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                      <p className="text-[9px] text-on-surface-variant mt-1 truncate" title={m.originalName}>{m.originalName.replace(/\.[^.]+$/, '')}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {sugData && sugData.total > 15 && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <button onClick={() => setSugPage(p => Math.max(1, p - 1))} disabled={sugPage <= 1} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-30">上一页</button>
                <span className="text-sm text-on-surface-variant">{sugPage} / {Math.ceil(sugData.total / 15)}</span>
                <button onClick={() => setSugPage(p => p + 1)} disabled={sugPage >= Math.ceil(sugData.total / 15)} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-30">下一页</button>
              </div>
            )}
            {sugData?.data.length === 0 && <p className="text-center text-on-surface-variant py-12">没有需要合并的同名模型</p>}
          </div>
        )
      ) : (
      isLoading ? (
        <SkeletonList rows={5} />
      ) : (
        <>
          <div className="bg-surface-container-low rounded-lg border border-outline-variant/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant/20">
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">模型</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">分类</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">格式</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">大小</th>
                  <th className="text-left px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">图纸</th>
                  <th className="text-right px-4 py-3 text-xs uppercase tracking-wider text-on-surface-variant font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((m) => (
                  <tr key={m.model_id} className="border-b border-outline-variant/10 hover:bg-surface-container-high/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/model/${m.model_id}`} target="_blank" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <div className="w-10 h-10 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                          <ModelThumbnail src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-on-surface font-medium truncate max-w-[300px] block">{m.name}</span>
                          {m.group && <span className="text-[10px] text-primary font-medium">{m.group.name} {m.group.is_primary ? '· 主版本' : ''} (共{m.group.variant_count}个)</span>}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">{m.category || '—'}</td>
                    <td className="px-4 py-3"><span className="text-xs font-mono bg-surface-container-highest px-1.5 py-0.5 rounded-sm">{m.format?.toUpperCase()}</span></td>
                    <td className="px-4 py-3 text-on-surface-variant font-mono">{formatSize(m.original_size)}</td>
                    <td className="px-4 py-3">{m.drawing_url ? <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-sm font-medium">PDF</span> : <span className="text-[10px] text-on-surface-variant/30">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link to={`/model/${m.model_id}`} target="_blank" className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 rounded-sm transition-colors border border-outline-variant/20"><Icon name="open_in_new" size={14} />查看</Link>
                        <button onClick={() => setEditModel(m)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20"><Icon name="settings" size={14} />编辑</button>
                        <button onClick={() => setDeleteTarget(m)} className="flex items-center gap-1 px-2.5 py-1 text-xs text-on-surface-variant hover:text-error hover:bg-error/10 rounded-sm transition-colors border border-outline-variant/20"><Icon name="close" size={14} />删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data?.items.length === 0 && (<tr><td colSpan={6} className="px-4 py-12 text-center text-on-surface-variant">没有找到模型</td></tr>)}
              </tbody>
            </table>
          </div>
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors">上一页</button>
              <span className="text-sm text-on-surface-variant">{page} / {data.totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} className="px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors">下一页</button>
            </div>
          )}
        </>
      )
      )}

      <EditDialog open={!!editModel} model={editModel} categories={categories || []} onClose={() => setEditModel(null)} onSaved={() => mutate()} />
      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-6">
              <h3 className="font-headline text-lg font-semibold text-on-surface mb-2">确认删除</h3>
              <p className="text-sm text-on-surface-variant mb-6">确定要删除「{deleteTarget.name}」吗？此操作不可撤销。</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors">取消</button>
                <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-error text-white rounded-sm text-sm hover:bg-error/90 transition-colors disabled:opacity-50">{deleting ? '删除中...' : '删除'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function MobileContent() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editModel, setEditModel] = useState<ServerModelListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerModelListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, mutate } = useSWR(['/admin/models/m', search, page], () => modelApi.list({ search: search || undefined, page, pageSize: 20, grouped: false }));
  const { data: catDataM } = useSWR('/categories-m', () => categoriesApi.tree());
  const categories = catDataM?.items || [];

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await modelApi.delete(deleteTarget.model_id); toast('已删除', 'success'); mutate(); setDeleteTarget(null); } catch { toast('删除失败', 'error'); } finally { setDeleting(false); }
  };

  const handleUpload = async (files: FileList) => {
    const accepted = Array.from(files).filter(f => { const ext = f.name.split('.').pop()?.toLowerCase() || ''; return ['step', 'stp', 'iges', 'igs', 'xt', 'x_t'].includes(ext); });
    if (accepted.length === 0) { toast('请选择 STEP/IGES/XT 格式的文件', 'error'); return; }
    setUploading(true);
    let ok = 0, fail = 0;
    // Upload with limited concurrency (3 at a time)
    const CONCURRENCY = 3;
    for (let i = 0; i < accepted.length; i += CONCURRENCY) {
      const batch = accepted.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(f => modelApi.upload(f)));
      for (const r of results) { if (r.status === "fulfilled") ok++; else fail++; }
    }
    setUploading(false);
    toast(`上传完成: ${ok} 成功${fail > 0 ? `, ${fail} 失败` : ''}`, fail > 0 ? 'error' : 'success');
    mutate();
  };

  return (
    <>
      <input type="file" multiple accept=".step,.stp,.iges,.igs,.xt,.x_t" className="hidden" id="mobile-admin-upload" onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ''; }} />
      <div className="px-4 py-4 space-y-4 pb-20">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-on-surface">模型管理</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant">{data?.total || 0} 个</span>
            <button onClick={() => document.getElementById('mobile-admin-upload')?.click()} disabled={uploading} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-on-primary bg-primary-container rounded-sm active:scale-95 disabled:opacity-50">
              <Icon name="cloud_upload" size={14} />{uploading ? '上传中...' : '上传'}
            </button>
          </div>
        </div>
        <div className="flex items-center bg-surface-container-high rounded-sm px-3 py-2 border border-outline-variant/30">
          <Icon name="search" size={16} className="text-on-surface-variant mr-2" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="搜索模型..." className="bg-transparent border-none outline-none text-sm text-on-surface placeholder:text-on-surface-variant/50 w-full" />
        </div>
        {isLoading ? (
          <SkeletonList rows={5} />
        ) : (
          <div className="space-y-2">
            {data?.items.map((m) => (
              <Link key={m.model_id} to={`/model/${m.model_id}`} target="_blank" className="bg-surface-container-high rounded-sm p-3 flex items-center gap-3 hover:bg-surface-container-highest transition-colors">
                <div className="w-12 h-12 rounded-sm bg-surface-container-highest shrink-0 overflow-hidden">
                  <ModelThumbnail src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-on-surface font-medium truncate">{m.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-mono bg-surface-container-highest px-1 py-0.5 rounded-sm">{m.format?.toUpperCase()}</span>
                    <span className="text-[10px] text-on-surface-variant">{m.category || '未分类'}</span>
                    <span className="text-[10px] text-on-surface-variant font-mono">{formatSize(m.original_size)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.preventDefault()}>
                  <button onClick={() => setEditModel(m)} className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-on-surface rounded-sm border border-outline-variant/20"><Icon name="settings" size={14} /></button>
                  <button onClick={() => setDeleteTarget(m)} className="px-2 py-1.5 text-xs text-on-surface-variant hover:text-error rounded-sm border border-outline-variant/20"><Icon name="close" size={14} /></button>
                </div>
              </Link>
            ))}
            {data?.items.length === 0 && <p className="text-center text-on-surface-variant py-12 text-sm">没有找到模型</p>}
            {data && data.totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-xs text-on-surface-variant disabled:opacity-30">上一页</button>
                <span className="text-xs text-on-surface-variant">{page}/{data.totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} className="px-3 py-1.5 text-xs text-on-surface-variant disabled:opacity-30">下一页</button>
              </div>
            )}
          </div>
        )}
      </div>
      <EditDialog open={!!editModel} model={editModel} categories={categories || []} onClose={() => setEditModel(null)} onSaved={() => mutate()} />
      <AnimatePresence>
        {deleteTarget && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-surface-dim/70 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}>
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="bg-surface-container-low rounded-lg shadow-xl border border-outline-variant/20 w-full max-w-sm mx-4 p-6">
              <h3 className="font-headline text-base font-semibold text-on-surface mb-2">确认删除</h3>
              <p className="text-sm text-on-surface-variant mb-5">确定要删除「{deleteTarget.name}」吗？</p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-on-surface-variant">取消</button>
                <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-error text-white rounded-sm text-sm disabled:opacity-50">{deleting ? '删除中...' : '删除'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function ModelAdminPage() {
  useDocumentTitle('模型管理');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [navOpen, setNavOpen] = useState(false);

  if (isDesktop) {
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <main className="flex-1 overflow-y-auto p-8 scrollbar-hidden bg-surface-dim">
            <DesktopContent />
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
        <MobileContent />
      </main>
      <BottomNav />
    </div>
  );
}
