import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import { getSettings, updateSettings, uploadImage } from '../api/settings';
import { AdminContentPanel, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  navNodeItems,
  nextNavId,
  parseCategoryNavConfig,
  type CategoryNavConfig,
  type CategoryNavItem,
  type CategoryNavNode,
  type CategoryNavSection,
} from '../lib/categoryNav';

/**
 * 导航管理页（/admin/category-nav）——编辑 category_nav_config 的模型 section：
 * - 组：改组名/颜色、增删组（组下有节点禁止删）；
 * - 节点：拖拽排序（组内顺序 = 拓扑图卡位顺序）、增删节点、节点图标（可传图/重置回默认插画）、
 *   每个节点 1~6 个分类项（分类下拉 + 自定义名 + 合并名 + 逐项图片上传）；
 * 选型 section 暂不提供编辑（数据保留，前台弹窗「选型」按钮仍生效）。
 * 保存 PUT /api/settings（服务端同构校验），公开页立即生效。
 */

/** 每节点最多分类项数（与服务端 CATEGORY_NAV_ITEM_LIMIT 一致） */
const MAX_ITEMS = 6;

type DraftSection = CategoryNavSection;

export default function CategoryNavAdminPage() {
  useDocumentTitle('导航管理');
  const { t } = useTranslation();

  const {
    data: rawSettings,
    isLoading,
    mutate,
  } = useSWR('admin-settings', () => getSettings(), { revalidateIfStale: false });

  const [draft, setDraft] = useState<CategoryNavConfig | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadRef = useRef<{ nodeId: string; itemIndex: number | null } | null>(null);
  const dragNodeRef = useRef<{ nodeId: string; groupId: string } | null>(null);
  // 大类（组）折叠状态：默认全部展开
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (rawSettings && !draft) {
      const parsed = parseCategoryNavConfig(rawSettings.category_nav_config);
      setDraft(parsed);
      if (parsed) setSavedSnapshot(JSON.stringify(parsed));
    }
  }, [rawSettings, draft]);

  // 目录：模型 = Category 树拍平（含父子路径）
  const { data: modelCats } = useSWR('/categories', () => categoriesApi.tree(), { revalidateIfStale: false });

  const modelOptions = useMemo(() => {
    const out: Array<{ id: string; label: string }> = [];
    const walk = (items: CategoryItem[], prefix: string) => {
      for (const item of items) {
        out.push({ id: item.id, label: prefix ? `${prefix} / ${item.name}` : item.name });
        if (item.children?.length) walk(item.children, item.name);
      }
    };
    if (modelCats?.items) walk(modelCats.items, '');
    return out;
  }, [modelCats]);

  const options = modelOptions;

  if (isLoading || !draft) {
    return (
      <AdminPageShell>
        <AdminManagementPage title={t('categoryNav.admin.title')} description={t('categoryNav.admin.description')}>
          <AdminLoadingState variant="dashboard" label={t('categoryNav.admin.title')} />
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  const section: DraftSection = draft.model;
  // 脏状态：draft 与最近一次保存的快照比对（系统设置同款交互）
  const changed = JSON.stringify(draft) !== savedSnapshot;

  // —— draft 修改器（都在 section 局部替换） ——
  const patchSection = (patch: Partial<DraftSection>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next.model = { ...section, ...patch };
      return next;
    });
  };

  const patchNode = (nodeId: string, patch: Partial<CategoryNavNode>) => {
    patchSection({ nodes: section.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) });
  };

  const patchItem = (nodeId: string, index: number, patch: Partial<CategoryNavItem>) => {
    const node = section.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const items = navNodeItems(node).map((it, i) => (i === index ? { ...it, ...patch } : it));
    patchNode(nodeId, { items });
  };

  const addNode = (groupId: string) => {
    const id = nextNavId(
      section.nodes.map((n) => n.id),
      'n-model',
    );
    patchSection({
      nodes: [...section.nodes, { id, groupId, items: [{ categoryId: null, customName: '' }] }],
    });
  };

  const removeNode = (nodeId: string) => {
    patchSection({ nodes: section.nodes.filter((n) => n.id !== nodeId) });
  };

  const addItem = (nodeId: string) => {
    const node = section.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const items = navNodeItems(node);
    if (items.length >= MAX_ITEMS) return;
    patchNode(nodeId, { items: [...items, { categoryId: null, customName: '' }] });
  };

  const removeItem = (nodeId: string, index: number) => {
    const node = section.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const items = navNodeItems(node).filter((_, i) => i !== index);
    if (!items.length) return; // 保底 1 项
    patchNode(nodeId, { items });
  };

  // 拖拽排序（组内）：HTML5 DnD（dragNodeRef 已提升到组件顶部满足 Hook 规则）
  const handleDropOnNode = (targetNodeId: string) => {
    const src = dragNodeRef.current;
    if (!src) return;
    const target = section.nodes.find((n) => n.id === targetNodeId);
    if (!target || target.groupId !== src.groupId || targetNodeId === src.nodeId) return;
    const groupNodes = section.nodes.filter((n) => n.groupId === src.groupId);
    const fromIdx = groupNodes.findIndex((n) => n.id === src.nodeId);
    const toIdx = groupNodes.findIndex((n) => n.id === targetNodeId);
    const reordered = [...groupNodes];
    reordered.splice(toIdx, 0, reordered.splice(fromIdx, 1)[0]);
    const others = section.nodes.filter((n) => n.groupId !== src.groupId);
    // 保持其它组节点在前，重组内顺序在后（服务端只按数组序渲染分组过滤）
    patchSection({ nodes: [...others, ...reordered] });
    dragNodeRef.current = null;
  };

  // 组操作
  const addGroup = () => {
    const id = nextNavId(
      section.groups.map((g) => g.id),
      'g',
    );
    patchSection({ groups: [...section.groups, { id, name: '新分组', color: '#2563eb' }] });
  };
  const patchGroup = (gid: string, patch: Partial<{ name: string; color: string }>) => {
    patchSection({ groups: section.groups.map((g) => (g.id === gid ? { ...g, ...patch } : g)) });
  };
  const removeGroup = (gid: string) => {
    if (section.nodes.some((n) => n.groupId === gid)) return;
    patchSection({ groups: section.groups.filter((g) => g.id !== gid) });
  };

  // 图片上传：选文件 → POST（name=<tab>-<nodeId>[-itemIndex]）→ URL 写回节点或分类项
  // itemIndex 为 null 时是节点级图标（拓扑图卡位插画位），否则是分类项缩略图
  const pickImage = (nodeId: string, itemIndex: number | null) => {
    pendingUploadRef.current = { nodeId, itemIndex };
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = pendingUploadRef.current;
    e.target.value = '';
    pendingUploadRef.current = null;
    if (!file || !target) return;
    setUploadingKey(`${target.nodeId}#${target.itemIndex ?? 'node'}`);
    setError(null);
    try {
      const name =
        target.itemIndex == null ? `model-${target.nodeId}-icon` : `model-${target.nodeId}-${target.itemIndex}`;
      const { url } = await uploadImage(file, 'category_nav', name);
      if (target.itemIndex == null) {
        patchNode(target.nodeId, { imageUrl: url });
      } else {
        patchItem(target.nodeId, target.itemIndex, { imageUrl: url });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('categoryNav.admin.uploadFailed'));
    } finally {
      setUploadingKey(null);
    }
  };

  // 保存：客户端先做结构校验（服务端会再校验一遍）
  const handleSave = async () => {
    for (const sec of [draft.model]) {
      if (sec.groups.length > 6 || sec.nodes.length > 100) {
        setError(t('categoryNav.admin.tooMany'));
        return;
      }
      for (const n of sec.nodes) {
        if (!navNodeItems(n).some((it) => it.categoryId || it.customName?.trim())) {
          setError(t('categoryNav.admin.emptyNode'));
          return;
        }
      }
    }
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ category_nav_config: JSON.stringify(draft) });
      setSavedSnapshot(JSON.stringify(draft));
      await mutate();
      // 公开页缓存刷新
      fetch('/api/settings/public', { cache: 'no-store' });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('categoryNav.admin.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminPageShell>
      <AdminManagementPage
        title={t('categoryNav.admin.title')}
        meta={`${section.groups.length} ${t('categoryNav.admin.groups')} · ${section.nodes.length} ${t('categoryNav.admin.nodes')}`}
        description={t('categoryNav.admin.description')}
        actions={
          <div className="flex min-h-10 shrink-0 items-center justify-end gap-2">
            <span
              className={`hidden items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs md:inline-flex ${
                changed ? 'text-amber-500' : 'text-on-surface-variant'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${changed ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              {/* 两个文案都是 7 个字（CJK 等宽），切换时宽度不变，避免页面抖动 */}
              {changed ? '有未保存的修改' : '当前配置已保存'}
            </span>
            <button
              type="button"
              onClick={handleSave}
              disabled={!changed || saving}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-3.5 text-xs font-bold text-on-primary shadow-sm transition-all hover:-translate-y-px hover:opacity-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none md:h-8"
            >
              <Icon name={saving ? 'progress_activity' : 'save'} size={14} className={saving ? 'animate-spin' : ''} />
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        }
      >
        <AdminContentPanel scroll className="overflow-y-auto">
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          {error ? (
            <div className="mb-3 rounded-lg border border-error/30 bg-error-container/20 px-3 py-2 text-xs text-error">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-6 p-4">
            {section.groups.map((group) => {
              const groupNodes = section.nodes.filter((n) => n.groupId === group.id);
              return (
                <div
                  key={group.id}
                  className="rounded-xl border border-outline-variant/15 bg-surface-container-low p-4"
                >
                  {/* 组头：折叠按钮（Material 图标钮）+ 组名（= 前台大类标题）可编辑 */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.id)) next.delete(group.id);
                          else next.add(group.id);
                          return next;
                        })
                      }
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-outline-variant/25 bg-surface-container-lowest text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                      title={
                        collapsedGroups.has(group.id)
                          ? t('categoryNav.admin.expandGroup')
                          : t('categoryNav.admin.collapseGroup')
                      }
                    >
                      <Icon name={collapsedGroups.has(group.id) ? 'chevron_right' : 'expand_more'} size={18} />
                    </button>
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-outline-variant/30"
                      style={{ backgroundColor: group.color }}
                    />
                    <input
                      value={group.name}
                      onChange={(e) => patchGroup(group.id, { name: e.target.value })}
                      placeholder={t('categoryNav.admin.groupNamePlaceholder')}
                      className="w-44 rounded-md border border-outline-variant/20 bg-surface-container-lowest px-2 py-1 text-sm font-bold text-on-surface"
                      maxLength={30}
                      title={t('categoryNav.admin.groupNamePlaceholder')}
                    />
                    <input
                      type="color"
                      value={group.color}
                      onChange={(e) => patchGroup(group.id, { color: e.target.value })}
                      className="h-7 w-10 cursor-pointer rounded border border-outline-variant/20 bg-transparent"
                      title={t('categoryNav.admin.color')}
                    />
                    <span className="text-xs text-on-surface-variant">
                      {groupNodes.length} {t('categoryNav.admin.nodes')}
                    </span>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => addNode(group.id)}
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary-container/10"
                    >
                      <Icon name="add" size={14} />
                      {t('categoryNav.admin.addNode')}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeGroup(group.id)}
                      disabled={groupNodes.length > 0}
                      title={
                        groupNodes.length ? t('categoryNav.admin.groupNotEmpty') : t('categoryNav.admin.removeGroup')
                      }
                      className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-on-surface-variant hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </div>

                  {/* 节点列表（折叠时隐藏） */}
                  {collapsedGroups.has(group.id) ? null : groupNodes.length === 0 ? (
                    <p className="py-4 text-center text-xs text-on-surface-variant">{t('categoryNav.admin.noNodes')}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {groupNodes.map((node, idx) => {
                        const items = navNodeItems(node);
                        return (
                          <div
                            key={node.id}
                            draggable
                            onDragStart={() => (dragNodeRef.current = { nodeId: node.id, groupId: group.id })}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => handleDropOnNode(node.id)}
                            className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest p-3"
                          >
                            <div className="mb-2 flex items-center gap-2">
                              <Icon
                                name="drag_indicator"
                                size={16}
                                className="cursor-grab text-on-surface-variant/50"
                              />
                              {/* 节点级图标：拓扑图卡位插画位（未传时前台显示 SMC 默认插画） */}
                              <button
                                type="button"
                                onClick={() => pickImage(node.id, null)}
                                className="grid h-9 w-11 shrink-0 place-items-center overflow-hidden rounded border border-outline-variant/20 bg-surface-container"
                                title={t('categoryNav.admin.pickNodeIcon')}
                              >
                                {uploadingKey === `${node.id}#node` ? (
                                  <Icon
                                    name="progress_activity"
                                    size={15}
                                    className="animate-spin text-on-surface-variant/50"
                                  />
                                ) : node.imageUrl ? (
                                  <img src={node.imageUrl} alt="" className="h-full w-full object-contain" />
                                ) : (
                                  <Icon name="image" size={15} className="text-on-surface-variant/40" />
                                )}
                              </button>
                              <span className="rounded bg-surface-container px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant">
                                #{idx + 1}
                              </span>
                              <input
                                value={node.label ?? ''}
                                onChange={(e) => patchNode(node.id, { label: e.target.value })}
                                placeholder={t('categoryNav.admin.labelPlaceholder')}
                                className="w-28 rounded-md border border-outline-variant/20 bg-surface-container-lowest px-2 py-1 text-xs font-bold text-on-surface"
                                maxLength={30}
                                title={t('categoryNav.admin.labelPlaceholder')}
                              />
                              <input
                                value={node.description ?? ''}
                                onChange={(e) => patchNode(node.id, { description: e.target.value })}
                                placeholder={t('categoryNav.admin.descriptionPlaceholder')}
                                className="min-w-0 flex-1 rounded-md border border-outline-variant/20 bg-surface-container px-2 py-1 text-xs text-on-surface"
                                maxLength={100}
                              />
                              {node.imageUrl ? (
                                <button
                                  type="button"
                                  onClick={() => patchNode(node.id, { imageUrl: undefined })}
                                  className="rounded p-1 text-on-surface-variant/60 hover:text-error"
                                  title={t('categoryNav.admin.resetNodeIcon')}
                                >
                                  <Icon name="restart_alt" size={14} />
                                </button>
                              ) : null}
                              <span className="text-[10px] text-on-surface-variant">{node.id}</span>
                              <button
                                type="button"
                                onClick={() => removeNode(node.id)}
                                className="rounded p-1 text-on-surface-variant/60 hover:text-error"
                                title={t('categoryNav.admin.removeNode')}
                              >
                                <Icon name="close" size={14} />
                              </button>
                            </div>

                            {/* 分类项列表 */}
                            <div className="ml-6 flex flex-col gap-2">
                              {items.map((it, j) => {
                                const uploading = uploadingKey === `${node.id}#${j}`;
                                return (
                                  <div key={j} className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => pickImage(node.id, j)}
                                      className="grid h-9 w-11 shrink-0 place-items-center overflow-hidden rounded border border-outline-variant/20 bg-surface-container"
                                      title={t('categoryNav.admin.pickImage')}
                                    >
                                      {uploading ? (
                                        <Icon
                                          name="progress_activity"
                                          size={15}
                                          className="animate-spin text-on-surface-variant/50"
                                        />
                                      ) : it.imageUrl ? (
                                        <img src={it.imageUrl} alt="" className="h-full w-full object-contain" />
                                      ) : (
                                        <Icon name="image" size={15} className="text-on-surface-variant/40" />
                                      )}
                                    </button>
                                    <select
                                      value={it.categoryId ?? ''}
                                      onChange={(e) =>
                                        patchItem(node.id, j, {
                                          categoryId: e.target.value || null,
                                          customName: e.target.value ? undefined : it.customName,
                                        })
                                      }
                                      className="min-w-0 max-w-56 flex-1 rounded-md border border-outline-variant/20 bg-surface-container px-2 py-1 text-xs text-on-surface"
                                    >
                                      <option value="">{t('categoryNav.admin.customOption')}</option>
                                      {options.map((opt) => (
                                        <option key={opt.id} value={opt.id}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      value={it.customName ?? ''}
                                      onChange={(e) => patchItem(node.id, j, { customName: e.target.value })}
                                      placeholder={t('categoryNav.admin.customNamePlaceholder')}
                                      disabled={Boolean(it.categoryId)}
                                      className="w-36 rounded-md border border-outline-variant/20 bg-surface-container px-2 py-1 text-xs text-on-surface disabled:opacity-40"
                                      maxLength={50}
                                    />
                                    {it.imageUrl ? (
                                      <button
                                        type="button"
                                        onClick={() => patchItem(node.id, j, { imageUrl: undefined })}
                                        className="rounded p-1 text-on-surface-variant/60 hover:text-error"
                                        title={t('categoryNav.admin.removeImage')}
                                      >
                                        <Icon name="restart_alt" size={14} />
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => removeItem(node.id, j)}
                                      disabled={items.length <= 1}
                                      className="rounded p-1 text-on-surface-variant/60 hover:text-error disabled:cursor-not-allowed disabled:opacity-30"
                                      title={
                                        items.length <= 1
                                          ? t('categoryNav.admin.lastItemHint')
                                          : t('categoryNav.admin.removeItem')
                                      }
                                    >
                                      <Icon name="remove_circle_outline" size={14} />
                                    </button>
                                  </div>
                                );
                              })}
                              {items.length < MAX_ITEMS ? (
                                <button
                                  type="button"
                                  onClick={() => addItem(node.id)}
                                  className="ml-0 inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary-container/10"
                                >
                                  <Icon name="add" size={13} />
                                  {t('categoryNav.admin.addItem')}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              type="button"
              onClick={addGroup}
              className="inline-flex w-fit items-center gap-1 rounded-lg border border-dashed border-outline-variant/40 px-4 py-2 text-xs font-bold text-on-surface-variant hover:border-primary hover:text-primary"
            >
              <Icon name="add" size={14} />
              {t('categoryNav.admin.addGroup')}
            </button>
          </div>
        </AdminContentPanel>
      </AdminManagementPage>
    </AdminPageShell>
  );
}
