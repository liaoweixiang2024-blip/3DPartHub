import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { categoriesApi, type CategoryItem } from '../api/categories';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import { AdminButton } from '../components/shared/AdminControls';
import {
  ADMIN_GRID_ROW_CLASS,
  ADMIN_ROW_META_CLASS,
  ADMIN_ROW_TITLE_CLASS,
  AdminGridHeader,
} from '../components/shared/AdminDataTable';
import { AdminContentPanel, AdminLoadingState, AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AppSwitch } from '../components/shared/FormControls';
import Icon from '../components/shared/Icon';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { getErrorMessage } from '../lib/errorNotifications';

const CATEGORY_ADMIN_GRID_COLUMNS = '28px 34px 44px minmax(0,1fr) 104px 68px 152px';

function CategoryRow({
  cat,
  depth = 0,
  inheritedRestricted = false,
  dragItem,
  dragDisabled = false,
  collapsedIds,
  onToggleCollapse,
  onDragStart,
  onDragEnd,
  onDropOn,
  onEdit,
  onAddChild,
  onDelete,
}: {
  cat: CategoryItem;
  depth?: number;
  /** 祖先有受限分类：子分类实际也被限制（自身开关可能未开），徽章加「继承」标识 */
  inheritedRestricted?: boolean;
  dragItem: { id: string; parentId: string | null } | null;
  dragDisabled?: boolean;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onDragStart: (cat: CategoryItem) => void;
  onDragEnd: () => void;
  onDropOn: (target: CategoryItem) => void;
  onEdit: (cat: CategoryItem) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (cat: CategoryItem) => void;
}) {
  const hasChildren = (cat.children?.length || 0) > 0;
  const isChild = depth > 0;
  const collapsed = hasChildren && collapsedIds.has(cat.id);
  const isDragging = dragItem?.id === cat.id;
  const isSameDragLevel = dragItem && dragItem.parentId === (cat.parentId || null) && dragItem.id !== cat.id;

  return (
    <>
      <div
        onDragOver={(e) => {
          if (dragDisabled || !isSameDragLevel) return;
          e.preventDefault();
        }}
        onDrop={(e) => {
          if (dragDisabled) return;
          e.preventDefault();
          onDropOn(cat);
        }}
        className={`${ADMIN_GRID_ROW_CLASS} min-h-[68px] grid-cols-[minmax(0,1fr)_96px] gap-2 px-3 py-3 sm:min-h-[68px] sm:grid-cols-[28px_34px_44px_minmax(0,1fr)_104px_68px_152px] sm:px-4 ${
          isChild ? 'bg-surface-container-lowest/45' : 'bg-surface-container-low'
        } ${isDragging ? 'opacity-45' : ''} ${isSameDragLevel ? 'ring-1 ring-inset ring-primary-container/15' : ''}`}
      >
        <span
          draggable={!dragDisabled}
          onDragStart={(e) => {
            if (dragDisabled) return;
            e.dataTransfer.effectAllowed = 'move';
            onDragStart(cat);
          }}
          onDragEnd={onDragEnd}
          className={`hidden h-8 w-7 shrink-0 select-none items-center justify-center rounded-lg text-on-surface-variant/45 sm:inline-flex ${
            dragDisabled
              ? 'cursor-not-allowed opacity-30'
              : 'cursor-grab hover:bg-surface-container-high hover:text-on-surface-variant active:cursor-grabbing'
          }`}
          title={dragDisabled ? '搜索时暂不支持拖拽排序' : '拖拽排序'}
          data-tooltip-ignore
        >
          ⠿
        </span>
        <div className="hidden sm:block">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggleCollapse(cat.id)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
              data-tooltip-ignore
              aria-label={collapsed ? '展开子分类' : '收起子分类'}
            >
              <Icon
                name="expand_more"
                size={18}
                className={`transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}
              />
            </button>
          ) : (
            <span className="block h-8 w-8" />
          )}
        </div>
        <span
          className={`hidden h-10 w-10 shrink-0 place-items-center rounded-xl sm:grid ${isChild ? 'bg-surface-container-high text-on-surface-variant' : 'bg-primary-container/10 text-primary-container'}`}
        >
          <Icon name={cat.icon || (hasChildren ? 'folder' : 'view_in_ar')} size={18} />
        </span>
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * (depth > 0 ? 12 : 0) }}>
          <span
            draggable={!dragDisabled}
            onDragStart={(e) => {
              if (dragDisabled) return;
              e.dataTransfer.effectAllowed = 'move';
              onDragStart(cat);
            }}
            onDragEnd={onDragEnd}
            className={`inline-flex h-8 w-7 shrink-0 select-none items-center justify-center rounded-lg text-on-surface-variant/45 sm:hidden ${
              dragDisabled
                ? 'cursor-not-allowed opacity-30'
                : 'cursor-grab hover:bg-surface-container-high hover:text-on-surface-variant active:cursor-grabbing'
            }`}
            title={dragDisabled ? '搜索时暂不支持拖拽排序' : '拖拽排序'}
            data-tooltip-ignore
          >
            ⠿
          </span>
          <span className="sm:hidden">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => onToggleCollapse(cat.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                data-tooltip-ignore
                aria-label={collapsed ? '展开子分类' : '收起子分类'}
              >
                <Icon
                  name="expand_more"
                  size={18}
                  className={`transition-transform ${collapsed ? '-rotate-90' : 'rotate-0'}`}
                />
              </button>
            ) : (
              <span className="block h-8 w-8" />
            )}
          </span>
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg sm:hidden ${isChild ? 'bg-surface-container-high text-on-surface-variant' : 'bg-primary-container/10 text-primary-container'}`}
          >
            <Icon name={cat.icon || (hasChildren ? 'folder' : 'view_in_ar')} size={18} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className={ADMIN_ROW_TITLE_CLASS}>{cat.name}</span>
              {cat.restricted && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-error/15 px-2 py-1 text-[10px] font-medium text-error"
                  title="该分类已开启访问限制"
                >
                  <Icon name="lock" size={10} />
                  受限
                </span>
              )}
              {!cat.restricted && inheritedRestricted && (
                <span
                  className="inline-flex items-center gap-0.5 rounded-full bg-error/10 px-2 py-1 text-[10px] text-error/80"
                  title="父分类已开启访问限制，限制沿子树向下生效"
                >
                  <Icon name="lock" size={10} />
                  受限（继承）
                </span>
              )}
              {isChild && (
                <span className="hidden rounded-full bg-surface-container-high px-2 py-1 text-[10px] text-on-surface-variant sm:inline">
                  子分类
                </span>
              )}
            </div>
            <div className={`${ADMIN_ROW_META_CLASS} mt-1 hidden flex-wrap items-center gap-2 text-[11px] sm:flex`}>
              <span>ID: {cat.id.slice(0, 8)}</span>
              <span>图标: {cat.icon || 'folder'}</span>
            </div>
          </div>
        </div>

        <div className="hidden text-right sm:block sm:text-left">
          <button
            type="button"
            onClick={() => hasChildren && onToggleCollapse(cat.id)}
            disabled={!hasChildren}
            className={`rounded-full px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
              hasChildren
                ? 'bg-primary-container/10 text-primary-container hover:bg-primary-container/15'
                : 'bg-surface-container-high text-on-surface-variant disabled:cursor-default'
            }`}
          >
            {hasChildren ? `${cat.children.length} 个子类` : '无子类'}
          </button>
        </div>
        <div className="hidden text-xs text-on-surface-variant sm:block">
          <span className="font-mono">排序 {cat.sortOrder}</span>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1 sm:gap-1.5">
          {!isChild && (
            <button
              type="button"
              onClick={() => onAddChild(cat.id)}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap text-primary-container hover:bg-primary-container/10 sm:px-2.5"
              data-tooltip-ignore
              aria-label="添加子分类"
              title="添加子分类"
            >
              <Icon name="add" size={14} />
              <span className="hidden sm:inline">子类</span>
            </button>
          )}
          <button
            onClick={() => onEdit(cat)}
            className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-primary-container/10 hover:text-primary-container"
            data-tooltip-ignore
            aria-label="编辑"
          >
            <Icon name="edit" size={15} />
          </button>
          <button
            onClick={() => onDelete(cat)}
            className="grid h-8 w-8 place-items-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container/10 hover:text-error"
            data-tooltip-ignore
            aria-label="删除"
          >
            <Icon name="delete" size={15} />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {hasChildren &&
          !collapsed &&
          cat.children?.map((child) => (
            <motion.div
              key={child.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16 }}
              className="overflow-hidden"
            >
              <CategoryRow
                cat={child}
                depth={depth + 1}
                inheritedRestricted={inheritedRestricted || cat.restricted === true}
                dragItem={dragItem}
                dragDisabled={dragDisabled}
                collapsedIds={collapsedIds}
                onToggleCollapse={onToggleCollapse}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDropOn={onDropOn}
                onEdit={onEdit}
                onAddChild={onAddChild}
                onDelete={onDelete}
              />
            </motion.div>
          ))}
      </AnimatePresence>
    </>
  );
}

// 可授权的角色（ADMIN 始终可见，不在此列）
const ACCESS_ROLE_OPTIONS = [
  { value: 'EDITOR', label: '编辑者' },
  { value: 'VIEWER', label: '访客' },
  { value: 'INTERNAL', label: '内部' },
];

/** 沿祖先链检查是否存在受限分类：编辑已有分类时从其 parentId 向上爬；新增子分类时从 addParentId 向上爬 */
function isAncestorRestricted(editing: CategoryItem | null, addParentId: string | null, tree: CategoryItem[]): boolean {
  const startId = editing?.parentId ?? addParentId ?? null;
  if (!startId) return false;
  // 建 id → 节点（含 restricted）索引
  const byId = new Map<string, CategoryItem>();
  const walk = (cats: CategoryItem[]) => {
    for (const c of cats) {
      byId.set(c.id, c);
      if (c.children?.length) walk(c.children);
    }
  };
  walk(tree);
  const visited = new Set<string>();
  let currentId: string | null = startId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = byId.get(currentId);
    if (!node) return false;
    if (node.restricted) return true;
    currentId = node.parentId;
  }
  return false;
}

interface AccessUserOption {
  id: string;
  username: string;
  email: string;
  role: string;
}

/** 分类弹窗里的「访问限制」区块：受限开关 + 角色勾选 + 指定用户搜索多选 */
function CategoryAccessSection({
  restricted,
  onRestrictedChange,
  allowedRoles,
  onAllowedRolesChange,
  allowedUsers,
  onAllowedUsersChange,
}: {
  restricted: boolean;
  onRestrictedChange: (value: boolean) => void;
  allowedRoles: string[];
  onAllowedRolesChange: (roles: string[]) => void;
  allowedUsers: AccessUserOption[];
  onAllowedUsersChange: (users: AccessUserOption[]) => void;
}) {
  const [userSearch, setUserSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(userSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [userSearch]);

  const { data: searchResults, isLoading: searching } = useSWR(
    searchOpen && debouncedSearch ? `/admin/users?search=${encodeURIComponent(debouncedSearch)}` : null,
    async (url: string) => {
      const res = await client.get(url, { params: { page: 1, page_size: 8 } });
      return unwrapResponse<{ items: AccessUserOption[] }>(res);
    },
  );

  const selectedIds = new Set(allowedUsers.map((u) => u.id));
  const options = (searchResults?.items ?? []).filter((u) => !selectedIds.has(u.id));

  function toggleRole(role: string) {
    onAllowedRolesChange(
      allowedRoles.includes(role) ? allowedRoles.filter((r) => r !== role) : [...allowedRoles, role],
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-on-surface">
          <Icon name="lock" size={16} className="text-on-surface-variant" />
          访问限制
        </span>
        <AppSwitch checked={restricted} onChange={onRestrictedChange} />
      </div>
      <p className="mt-1.5 text-[11px] text-on-surface-variant/70">
        开启后，该分类（含子分类）下的模型仅对白名单内的角色和指定用户可见；管理员始终可见。公开分享链接不受影响。
      </p>

      {restricted && (
        <div className="mt-3 space-y-3 border-t border-outline-variant/10 pt-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-on-surface-variant">允许访问的角色</div>
            <div className="flex flex-wrap gap-2">
              {ACCESS_ROLE_OPTIONS.map((opt) => {
                const active = allowedRoles.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleRole(opt.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-primary-container/15 text-primary-container ring-1 ring-primary-container/30'
                        : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest'
                    }`}
                  >
                    {active ? '✓ ' : ''}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative">
            <div className="mb-1.5 text-xs font-medium text-on-surface-variant">指定用户（搜索用户名 / 邮箱）</div>
            <input
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="输入关键词搜索用户"
              className="h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none focus:border-primary-container"
            />
            {allowedUsers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {allowedUsers.map((u) => (
                  <span
                    key={u.id}
                    className="inline-flex items-center gap-1 rounded-full bg-primary-container/12 px-2.5 py-1 text-xs text-primary-container"
                  >
                    {u.username}
                    <button
                      type="button"
                      onClick={() => onAllowedUsersChange(allowedUsers.filter((x) => x.id !== u.id))}
                      className="rounded-full p-0.5 hover:bg-primary-container/20"
                      aria-label={`移除 ${u.username}`}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {searchOpen && debouncedSearch && (
              <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-outline-variant/20 bg-surface-container-low shadow-xl">
                {searching ? (
                  <p className="px-3 py-2.5 text-xs text-on-surface-variant">搜索中...</p>
                ) : options.length === 0 ? (
                  <p className="px-3 py-2.5 text-xs text-on-surface-variant">无匹配用户</p>
                ) : (
                  options.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        onAllowedUsersChange([...allowedUsers, u]);
                        setUserSearch('');
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-container-high"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-on-surface">{u.username}</span>
                        <span className="block truncate text-[11px] text-on-surface-variant">{u.email}</span>
                      </span>
                      <span className="shrink-0 rounded bg-surface-container-highest px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                        {u.role}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {allowedRoles.length === 0 && allowedUsers.length === 0 && (
            <p className="rounded-lg bg-error/10 px-2.5 py-1.5 text-[11px] text-error">
              白名单为空：除管理员外所有人都看不到该分类。请至少勾选一个角色或添加一个用户。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryModal({
  category,
  parentId,
  parentRestricted,
  onClose,
  onSaved,
}: {
  category?: CategoryItem | null;
  parentId?: string | null;
  /** 直接父分类（或其祖先）已受限：本分类实际已被限制，弹窗里提示继承关系 */
  parentRestricted?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name || '');
  const [icon, setIcon] = useState(category?.icon || 'folder');
  const [restricted, setRestricted] = useState(category?.restricted ?? false);
  const [allowedRoles, setAllowedRoles] = useState<string[]>(category?.allowedRoles ?? []);
  const [allowedUsers, setAllowedUsers] = useState<AccessUserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const isEdit = !!category;
  // 已选指定用户的 id → 展示名兜底（编辑时从接口只拿到 id，回显用首次搜索结果或 admin users 补齐）
  const allowedUserIds = category?.allowedUserIds ?? [];

  // 编辑时回显白名单用户名：拉一页用户列表按 id 匹配（低频管理操作，简单实现）
  useEffect(() => {
    if (!isEdit || allowedUserIds.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const collected: AccessUserOption[] = [...allowedUsers];
        const missing = allowedUserIds.filter((id) => !collected.some((u) => u.id === id));
        if (missing.length === 0) return;
        const res = await client.get('/admin/users', { params: { page: 1, page_size: 100 } });
        const payload = unwrapResponse<{ items: AccessUserOption[] }>(res);
        if (cancelled) return;
        const byId = new Map(payload.items.map((u) => [u.id, u]));
        for (const id of missing) {
          const found = byId.get(id);
          if (found && !collected.some((u) => u.id === found.id)) collected.push(found);
        }
        // 用户超过 100 个时可能没拉全，未匹配到的用 id 占位展示
        for (const id of missing) {
          if (!collected.some((u) => u.id === id))
            collected.push({ id, username: id.slice(0, 8), email: '', role: '?' });
        }
        setAllowedUsers(collected);
      } catch {
        // 回显失败不阻塞编辑：保存时仍以完整 allowedUsers 为准
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, category?.id]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast('请输入分类名称', 'error');
      return;
    }
    if (restricted && allowedRoles.length === 0 && allowedUsers.length === 0) {
      toast('访问限制已开启，请至少勾选一个角色或添加一个指定用户', 'error');
      return;
    }
    setSaving(true);
    try {
      const accessPayload = {
        restricted,
        allowedRoles: restricted ? allowedRoles : [],
        allowedUserIds: restricted ? allowedUsers.map((u) => u.id) : [],
      };
      if (isEdit) {
        await categoriesApi.update(category!.id, { name: name.trim(), icon, ...accessPayload });
      } else {
        await categoriesApi.create({ name: name.trim(), icon, parentId: parentId || null, ...accessPayload });
      }
      toast(isEdit ? '分类已更新' : '分类已创建', 'success');
      onSaved();
      onClose();
    } catch {
      toast('操作失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const iconOptions = [
    'folder',
    'stainless_steel',
    'iron_hydraulic',
    'copper',
    'pneumatic',
    'assembly',
    'valve',
    'accessories',
    'universal_pipe',
    'air_tank',
    'pneumatic_fitting',
    'lubrication',
    'pipeline',
    'other_materials',
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-on-surface">
              {isEdit ? '编辑模型分类' : parentId ? '添加子分类' : '添加模型分类'}
            </h2>
            <p className="mt-1 text-xs text-on-surface-variant">分类会用于模型库筛选、上传归类和模型详情页展示。</p>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-[72px_1fr] sm:items-start">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary-container/10 text-primary-container">
              <Icon name={icon || 'folder'} size={30} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-on-surface-variant">分类名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 w-full rounded-xl border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container focus:ring-2 focus:ring-primary-container/10"
                placeholder="输入分类名称"
                autoFocus
              />
              <p className="mt-1.5 text-[11px] text-on-surface-variant/70">
                建议使用产品族名称，例如“不锈钢接头”“气动阀门”。
              </p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-on-surface-variant">选择图标</label>
              <span className="rounded-full bg-surface-container-high px-2 py-1 text-[10px] text-on-surface-variant">
                {icon}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
              {iconOptions.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className={`group flex h-12 items-center justify-center rounded-xl border transition-all ${
                    icon === ic
                      ? 'border-primary-container bg-primary-container/12 shadow-sm ring-2 ring-primary-container/10'
                      : 'border-outline-variant/12 bg-surface-container-lowest hover:border-primary-container/35 hover:bg-surface-container-high'
                  }`}
                  title={ic}
                >
                  <Icon
                    name={ic}
                    size={20}
                    className={
                      icon === ic ? 'text-primary-container' : 'text-on-surface-variant group-hover:text-on-surface'
                    }
                  />
                </button>
              ))}
            </div>
          </div>

          {parentRestricted && (
            <p className="rounded-lg bg-error/10 px-2.5 py-1.5 text-[11px] text-error">
              上级分类已开启访问限制：无论本分类开关如何，限制都会沿子树向下生效（如需单独放开，请先关闭上级分类的限制）。
            </p>
          )}

          <CategoryAccessSection
            restricted={restricted}
            onRestrictedChange={setRestricted}
            allowedRoles={allowedRoles}
            onAllowedRolesChange={setAllowedRoles}
            allowedUsers={allowedUsers}
            onAllowedUsersChange={setAllowedUsers}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-outline-variant/10 bg-surface-container-low px-5 py-4 sm:flex sm:justify-end">
          <AdminButton onClick={onClose} className="w-full sm:w-auto" variant="secondary">
            取消
          </AdminButton>
          <AdminButton
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="w-full sm:w-auto"
            variant="primary"
          >
            {saving ? '保存中...' : '保存分类'}
          </AdminButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

function collectCategoryStats(items: CategoryItem[] = []) {
  let total = 0;
  let children = 0;

  const walk = (cats: CategoryItem[], depth = 0) => {
    for (const cat of cats) {
      total += 1;
      if (depth > 0) children += 1;
      if (cat.children?.length) walk(cat.children, depth + 1);
    }
  };

  walk(items);
  const modelCount = items.reduce((sum, cat) => sum + (cat.totalCount || 0), 0);
  return { total, roots: items.length, children, modelCount };
}

function filterCategoryTree(items: CategoryItem[], query: string): CategoryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  return items
    .map((cat) => {
      const childMatches = filterCategoryTree(cat.children || [], q);
      const haystack = `${cat.name} ${cat.icon || ''} ${cat.id}`.toLowerCase();
      const matched = haystack.includes(q);
      if (!matched && childMatches.length === 0) return null;
      return { ...cat, children: matched ? cat.children : childMatches };
    })
    .filter((cat): cat is CategoryItem => Boolean(cat));
}

function findSiblingsByParent(items: CategoryItem[], parentId: string | null): CategoryItem[] {
  if (!parentId) return items;
  for (const cat of items) {
    if (cat.id === parentId) return cat.children || [];
    const nested = findSiblingsByParent(cat.children || [], parentId);
    if (nested.length) return nested;
  }
  return [];
}

function Content() {
  const [showModal, setShowModal] = useState(false);
  const [editingCat, setEditingCat] = useState<CategoryItem | null>(null);
  const [addParentId, setAddParentId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const {
    value: query,
    draftValue: queryInputValue,
    setValue: setQuery,
    inputProps: queryInputProps,
  } = useImeSafeSearchInput();
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [dragItem, setDragItem] = useState<{ id: string; parentId: string | null } | null>(null);
  const [sorting, setSorting] = useState(false);
  const didInitCollapse = useRef(false);
  const { toast } = useToast();

  const { data: catData, mutate } = useSWR('/categories', () => categoriesApi.tree());
  const tree = catData?.items;
  const stats = useMemo(() => collectCategoryStats(tree || []), [tree]);
  const visibleTree = useMemo(() => filterCategoryTree(tree || [], query), [tree, query]);

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
      toast('分类已删除', 'success');
      mutate();
    } catch (err: unknown) {
      toast(getErrorMessage(err, '删除失败'), 'error');
    }
    setDeleteConfirm(null);
  };

  const handleAdd = () => {
    setEditingCat(null);
    setAddParentId(null);
    setShowModal(true);
  };
  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const rootIdsWithChildren = useMemo(
    () => (tree || []).filter((cat) => cat.children?.length).map((cat) => cat.id),
    [tree],
  );

  useEffect(() => {
    if (didInitCollapse.current || !rootIdsWithChildren.length) return;
    didInitCollapse.current = true;
    setCollapsedIds(new Set(rootIdsWithChildren));
  }, [rootIdsWithChildren]);

  const displayCollapsedIds = query.trim() ? new Set<string>() : collapsedIds;
  const dragDisabled = Boolean(query.trim()) || sorting;
  const toolbarStatus = query
    ? `搜索结果 ${visibleTree.length} 个一级分组，已自动展开匹配项`
    : sorting
      ? '正在保存排序...'
      : '';

  const handleDropCategory = async (target: CategoryItem) => {
    if (!tree || !dragItem || sorting) return;
    const parentId = target.parentId || null;
    if (dragItem.id === target.id) return;
    if (dragItem.parentId !== parentId) {
      toast('只能在同一层级内拖拽排序', 'error');
      setDragItem(null);
      return;
    }

    const siblings = findSiblingsByParent(tree, parentId);
    const fromIndex = siblings.findIndex((item) => item.id === dragItem.id);
    const toIndex = siblings.findIndex((item) => item.id === target.id);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      setDragItem(null);
      return;
    }

    const next = [...siblings];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);

    setSorting(true);
    try {
      await categoriesApi.reorder(next.map((item, index) => ({ id: item.id, sortOrder: index })));
      toast('排序已保存', 'success');
      await mutate();
    } catch (err) {
      toast(getErrorMessage(err, '排序保存失败'), 'error');
    } finally {
      setSorting(false);
      setDragItem(null);
    }
  };

  return (
    <AdminManagementPage
      title="分类管理"
      description="维护模型库分类、子分类和图标展示"
      actions={
        <AdminButton onClick={handleAdd} icon="add" variant="primary">
          添加分类
        </AdminButton>
      }
      toolbar={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-h-9 items-center divide-x divide-outline-variant/20 overflow-x-auto">
            <div className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-primary-container first:pl-0">
              <Icon name="folder" size={14} />
              <span>大类</span>
              <strong className="tabular-nums text-[11px] font-medium">{stats.roots}</strong>
            </div>
            <div className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-on-surface-variant">
              <Icon name="folder_open" size={14} />
              <span>子类</span>
              <strong className="tabular-nums text-[11px] font-medium text-on-surface">{stats.children}</strong>
            </div>
            <div className="flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-on-surface-variant">
              <Icon name="view_in_ar" size={14} />
              <span>型号</span>
              <strong className="tabular-nums text-[11px] font-medium text-on-surface">
                {stats.modelCount.toLocaleString()}
              </strong>
            </div>
            {toolbarStatus && (
              <span className="min-w-0 truncate px-1 text-xs text-on-surface-variant/75">{toolbarStatus}</span>
            )}
          </div>
          <div className="flex min-h-9 flex-wrap items-center justify-end gap-2">
            <SearchField
              inputProps={queryInputProps}
              value={queryInputValue}
              onClear={() => setQuery('')}
              placeholder="搜索分类..."
              className="md:w-72 md:shrink-0"
            />
          </div>
        </div>
      }
      contentClassName="overflow-hidden"
    >
      <div className="h-full min-h-0 overflow-hidden">
        {!tree ? (
          <AdminContentPanel scroll className="flex h-full min-h-0 flex-col">
            <AdminLoadingState
              rows={9}
              tableColumns="28px 34px 44px minmax(0,1fr) 104px 68px 152px"
              tableCells={['checkbox', 'text', 'chip', 'title', 'chip', 'text', 'actions']}
              className="h-full rounded-none border-0"
              label="分类加载中"
            />
          </AdminContentPanel>
        ) : (
          <AdminContentPanel scroll className="flex h-full min-h-0 flex-col">
            <AdminGridHeader columns={CATEGORY_ADMIN_GRID_COLUMNS} className="hidden shrink-0 gap-2 px-4 sm:grid">
              <span />
              <span />
              <span />
              <span>分类名称</span>
              <span>层级</span>
              <span>排序</span>
              <span className="text-right">操作</span>
            </AdminGridHeader>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
              {visibleTree.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  inheritedRestricted={false}
                  dragItem={dragItem}
                  dragDisabled={dragDisabled}
                  collapsedIds={displayCollapsedIds}
                  onToggleCollapse={toggleCollapse}
                  onDragStart={(item) => setDragItem({ id: item.id, parentId: item.parentId || null })}
                  onDragEnd={() => setDragItem(null)}
                  onDropOn={handleDropCategory}
                  onEdit={handleEdit}
                  onAddChild={handleAddChild}
                  onDelete={(c) => setDeleteConfirm(c.id)}
                />
              ))}

              {tree.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Icon name="folder_off" size={48} className="text-on-surface-variant/20" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-on-surface">暂无模型分类</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      添加第一个分类后，上传和模型库就可以按分类筛选。
                    </p>
                  </div>
                  <AdminButton onClick={handleAdd} icon="add" variant="primary">
                    添加分类
                  </AdminButton>
                </div>
              ) : (
                visibleTree.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-14 gap-2">
                    <Icon name="search_off" size={40} className="text-on-surface-variant/25" />
                    <p className="text-sm text-on-surface-variant">没有匹配的分类</p>
                    <button onClick={() => setQuery('')} className="text-sm text-primary-container hover:underline">
                      清空搜索
                    </button>
                  </div>
                )
              )}
            </div>
          </AdminContentPanel>
        )}
      </div>

      <AnimatePresence>
        {showModal && (
          <CategoryModal
            category={editingCat}
            parentId={addParentId}
            parentRestricted={isAncestorRestricted(editingCat, addParentId, tree || [])}
            onClose={() => {
              setShowModal(false);
              setEditingCat(null);
            }}
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
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="w-full max-w-sm rounded-2xl border border-outline-variant/20 bg-surface-container-low p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-error-container/15 text-error">
                  <Icon name="warning" size={20} />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-on-surface">确认删除分类</h3>
                  <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                    删除后不可恢复，如果分类下有关联模型，可能会影响模型筛选展示。
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <AdminButton onClick={() => setDeleteConfirm(null)} className="w-full" variant="secondary">
                  取消
                </AdminButton>
                <AdminButton onClick={() => handleDelete(deleteConfirm)} className="w-full" variant="danger">
                  确认删除
                </AdminButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AdminManagementPage>
  );
}

export default function CategoryAdminPage() {
  useDocumentTitle('分类管理');
  return (
    <AdminPageShell
      desktopContentClassName="min-h-0 overflow-hidden"
      mobileMainClassName="min-h-0 overflow-hidden"
      mobileContentClassName="flex h-full min-h-0 flex-col px-4 py-4 pb-20"
    >
      <Content />
    </AdminPageShell>
  );
}
