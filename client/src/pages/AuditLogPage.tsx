import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import {
  ADMIN_ROW_META_CLASS,
  ADMIN_ROW_TITLE_CLASS,
  AdminTable,
  AdminTableBodyRow,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeadRow,
  ADMIN_TABLE_HEAD_CLASS,
} from '../components/shared/AdminDataTable';
import {
  AdminContentPanel,
  AdminEmptyState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminButton, AdminIconButton } from '../components/shared/AdminControls';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import AdminRefreshButton from '../components/shared/AdminRefreshButton';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { copyText } from '../lib/clipboard';
import { getErrorMessage } from '../lib/errorNotifications';

type AuditDetails = {
  body?: Record<string, unknown>;
  method?: string;
  path?: string;
  statusCode?: number;
  timestamp?: string;
};

interface AuditEntry {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: AuditDetails | null;
  createdAt: string;
}

type AuditActionTabValue = 'all' | 'create' | 'update' | 'delete' | 'login' | 'download' | 'ticket' | 'settings';
type SearchInputProps = ReturnType<typeof useImeSafeSearchInput>['inputProps'];
type AuditPageResponse = { total: number; items: AuditEntry[]; page: number; page_size?: number };
type AuditStatsResponse = { total: number; actionGroups: Record<AuditActionTabValue, number> };
type AuditRetentionPolicy = {
  retentionDays: number;
  enabled: boolean;
  cutoffAt: string | null;
  deleteCount: number;
};
type AuditRetentionCleanupResult = {
  retentionDays: number;
  enabled: boolean;
  cutoffAt: string | null;
  deleted: number;
};

const AUDIT_PAGE_SIZE = 30;
const DEFAULT_AUDIT_RETENTION_DAYS = 365;
const RETENTION_OPTIONS = [
  { value: 0, label: '永久保留', description: '不自动清理历史日志' },
  { value: 90, label: '保留 90 天', description: '适合日志增长较快的场景' },
  { value: 180, label: '保留 180 天', description: '兼顾追溯和存储占用' },
  { value: 365, label: '保留 365 天', description: '默认推荐，便于年度追溯' },
];

const ACTION_MAP: Record<string, { label: string; color: string }> = {
  create: { label: '创建', color: 'text-green-500 bg-green-500/10' },
  upload: { label: '上传', color: 'text-green-500 bg-green-500/10' },
  update: { label: '更新', color: 'text-blue-500 bg-blue-500/10' },
  delete: { label: '删除', color: 'text-red-500 bg-red-500/10' },
  login: { label: '登录', color: 'text-amber-500 bg-amber-500/10' },
  download: { label: '下载', color: 'text-purple-500 bg-purple-500/10' },
  register: { label: '注册', color: 'text-teal-500 bg-teal-500/10' },
  settings_update: { label: '设置', color: 'text-cyan-500 bg-cyan-500/10' },
  favorite: { label: '收藏', color: 'text-pink-500 bg-pink-500/10' },
  unfavorite: { label: '取消收藏', color: 'text-on-surface-variant bg-surface-container-highest' },
  comment: { label: '评论', color: 'text-indigo-500 bg-indigo-500/10' },
  ticket_create: { label: '创建工单', color: 'text-primary-container bg-primary-container/10' },
  ticket_reply: { label: '回复工单', color: 'text-blue-500 bg-blue-500/10' },
  ticket_status: { label: '工单状态', color: 'text-amber-500 bg-amber-500/10' },
  backup_create: { label: '创建备份', color: 'text-cyan-500 bg-cyan-500/10' },
  backup_restore: { label: '恢复备份', color: 'text-amber-500 bg-amber-500/10' },
  backup_import_restore: { label: '导入恢复', color: 'text-amber-500 bg-amber-500/10' },
  backup_import_save: { label: '导入保存', color: 'text-cyan-500 bg-cyan-500/10' },
  backup_delete: { label: '删除备份', color: 'text-red-500 bg-red-500/10' },
  backup_download: { label: '下载备份', color: 'text-purple-500 bg-purple-500/10' },
  backup_rename: { label: '重命名备份', color: 'text-blue-500 bg-blue-500/10' },
  system_update: { label: '系统更新', color: 'text-cyan-500 bg-cyan-500/10' },
  audit_cleanup: { label: '清理日志', color: 'text-amber-500 bg-amber-500/10' },
};

const RESOURCE_MAP: Record<string, string> = {
  model: '模型',
  user: '用户',
  settings: '系统设置',
  category: '分类',
  comment: '评论',
  auth: '认证',
  ticket: '工单',
  favorite: '收藏',
  download: '下载',
  share: '分享',
  backup: '备份',
  audit: '审计',
  project: '项目',
  other: '其他',
};

const ACTION_TABS: Array<{ value: AuditActionTabValue; label: string; icon: string }> = [
  { value: 'all', label: '全部', icon: 'format_list_bulleted' },
  { value: 'create', label: '创建', icon: 'add_circle' },
  { value: 'update', label: '更新', icon: 'edit' },
  { value: 'delete', label: '删除', icon: 'delete' },
  { value: 'login', label: '登录', icon: 'login' },
  { value: 'download', label: '下载', icon: 'download' },
  { value: 'ticket', label: '工单', icon: 'build' },
  { value: 'settings', label: '设置', icon: 'settings' },
];

const RESOURCE_FILTERS: Array<{ value: string; label: string; icon: string }> = [
  { value: '', label: '全部资源', icon: 'apps' },
  { value: 'model', label: '模型', icon: 'view_in_ar' },
  { value: 'user', label: '用户', icon: 'person' },
  { value: 'category', label: '分类', icon: 'folder' },
  { value: 'auth', label: '认证', icon: 'login' },
  { value: 'ticket', label: '工单', icon: 'build' },
  { value: 'favorite', label: '收藏', icon: 'star' },
  { value: 'download', label: '下载', icon: 'download' },
  { value: 'share', label: '分享', icon: 'share' },
  { value: 'settings', label: '设置', icon: 'settings' },
  { value: 'backup', label: '备份', icon: 'database' },
  { value: 'audit', label: '审计', icon: 'policy' },
];

const BODY_LABELS: Record<string, string> = {
  name: '名称',
  title: '标题',
  status: '状态',
  classification: '分类',
  description: '描述',
  role: '角色',
  email: '邮箱',
  username: '用户',
  format: '格式',
  content: '内容',
  retentionDays: '保留天数',
  cutoffAt: '清理边界',
  deleted: '清理数量',
  source: '来源',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function formatExportTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function actionInfo(action: string) {
  return ACTION_MAP[action] || { label: action, color: 'text-on-surface-variant bg-surface-container-highest' };
}

function resourceLabel(resource: string) {
  return RESOURCE_MAP[resource] || resource;
}

function valueToText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getLogDetails(log: AuditEntry) {
  const detailLines: { label: string; value: string }[] = [];
  if (log.resourceId) detailLines.push({ label: '资源ID', value: log.resourceId });
  if (log.details?.body) {
    for (const [key, rawValue] of Object.entries(log.details.body)) {
      const value = valueToText(rawValue);
      if (!value) continue;
      detailLines.push({ label: BODY_LABELS[key] || key, value: value.slice(0, 160) });
    }
  }
  if (log.details?.method) detailLines.push({ label: '方法', value: log.details.method });
  if (log.details?.path) detailLines.push({ label: '路径', value: log.details.path });
  if (log.details?.statusCode) detailLines.push({ label: '状态码', value: String(log.details.statusCode) });
  return detailLines;
}

function getLogSummary(log: AuditEntry) {
  const body = log.details?.body;
  const primary = valueToText(body?.title || body?.name || body?.description || body?.status || body?.classification);
  if (primary) return primary;
  if (log.details?.path) return log.details.path;
  if (log.resourceId) return log.resourceId;
  return '无附加详情';
}

async function fetchAuditLogs({
  page,
  actionGroup,
  resource,
  search,
  size = AUDIT_PAGE_SIZE,
}: {
  page: number;
  actionGroup: AuditActionTabValue;
  resource: string;
  search: string;
  size?: number;
}) {
  const params: Record<string, string | number> = { page, size };
  if (actionGroup !== 'all') params.actionGroup = actionGroup;
  if (resource) params.resource = resource;
  if (search) params.search = search;
  return client.get('/audit', { params }).then((response) => unwrapResponse<AuditPageResponse>(response));
}

async function fetchAuditStats(resource: string, search: string) {
  const params: Record<string, string> = {};
  if (resource) params.resource = resource;
  if (search) params.search = search;
  return client.get('/audit/stats', { params }).then((response) => unwrapResponse<AuditStatsResponse>(response));
}

async function fetchAuditRetentionPolicy() {
  return client.get('/audit/retention').then((response) => unwrapResponse<AuditRetentionPolicy>(response));
}

async function updateAuditRetentionPolicy(retentionDays: number) {
  return client
    .put('/settings', { audit_log_retention_days: retentionDays })
    .then((response) => unwrapResponse<Record<string, unknown>>(response));
}

async function cleanupAuditLogsByRetention(retentionDays: number) {
  return client
    .post('/audit/retention/cleanup', { retentionDays })
    .then((response) => unwrapResponse<AuditRetentionCleanupResult>(response));
}

function useAuditActionCounts(resource: string, search: string) {
  const { data, mutate } = useSWR(['audit-action-counts', resource, search] as const, ([, nextResource, nextSearch]) =>
    fetchAuditStats(nextResource, nextSearch).then((result) => result.actionGroups),
  );
  return { counts: data, refreshCounts: mutate };
}

function DetailRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="w-14 shrink-0 text-on-surface-variant/60">{label}</span>
      <span className={`min-w-0 break-all text-on-surface-variant ${compact ? 'line-clamp-2' : ''}`}>{value}</span>
    </div>
  );
}

function LogSelectBox({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${
        checked
          ? 'border-primary-container bg-primary-container text-on-primary'
          : 'border-outline-variant/35 text-transparent hover:border-primary-container/50'
      }`}
      aria-label={checked ? '取消选择日志' : '选择日志'}
    >
      <Icon name="check" size={13} />
    </button>
  );
}

function LogRow({
  log,
  isDesktop,
  selectMode,
  selected,
  onToggleSelect,
}: {
  log: AuditEntry;
  isDesktop: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const act = actionInfo(log.action);
  const resLabel = resourceLabel(log.resource);
  const detailLines = getLogDetails(log);
  const summary = getLogSummary(log);
  const actor = log.username || (log.userId ? `${log.userId.slice(0, 8)}...` : '系统');

  if (isDesktop) {
    return (
      <>
        <AdminTableBodyRow
          className={`cursor-pointer ${selected ? 'bg-primary-container/8' : ''}`}
          onClick={() => setExpanded(!expanded)}
        >
          {selectMode ? (
            <AdminTableCell className="w-10">
              <LogSelectBox
                checked={selected}
                onToggle={(event) => {
                  event.stopPropagation();
                  onToggleSelect(log.id);
                }}
              />
            </AdminTableCell>
          ) : null}
          <AdminTableCell>
            <span className={`rounded-sm px-2 py-0.5 text-[10px] font-medium ${act.color}`}>{act.label}</span>
          </AdminTableCell>
          <AdminTableCell>
            <span className="rounded-sm bg-surface-container-highest px-2 py-0.5 text-[11px] font-medium text-on-surface-variant">
              {resLabel}
            </span>
          </AdminTableCell>
          <AdminTableCell className="min-w-0">
            <p className={`max-w-[520px] ${ADMIN_ROW_TITLE_CLASS}`}>{summary}</p>
            <p className={`mt-0.5 max-w-[520px] font-mono text-[10px] ${ADMIN_ROW_META_CLASS}`}>
              {log.resourceId || log.details?.path || log.id}
            </p>
          </AdminTableCell>
          <AdminTableCell muted>{actor}</AdminTableCell>
          <AdminTableCell muted className="whitespace-nowrap">
            {formatDateTime(log.createdAt)}
          </AdminTableCell>
        </AdminTableBodyRow>
        {expanded && detailLines.length > 0 ? (
          <AdminTableBodyRow className="bg-surface-container-high/20 hover:bg-surface-container-high/20">
            <AdminTableCell colSpan={selectMode ? 6 : 5}>
              <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                {detailLines.map((detail, index) => (
                  <DetailRow key={`${detail.label}-${index}`} label={detail.label} value={detail.value} compact />
                ))}
              </div>
            </AdminTableCell>
          </AdminTableBodyRow>
        ) : null}
      </>
    );
  }

  return (
    <div
      className={`cursor-pointer rounded-lg border p-3 transition-colors active:bg-surface-container-high ${
        selected
          ? 'border-primary-container/35 bg-primary-container/8'
          : 'border-outline-variant/10 bg-surface-container-low'
      }`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex min-w-0 gap-2">
        {selectMode ? (
          <div className="pt-0.5">
            <LogSelectBox
              checked={selected}
              onToggle={(event) => {
                event.stopPropagation();
                onToggleSelect(log.id);
              }}
            />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold ${act.color}`}>{act.label}</span>
            <span className="rounded-sm bg-surface-container-highest px-1.5 py-0.5 text-[10px] text-on-surface-variant">
              {resLabel}
            </span>
            <span className="ml-auto whitespace-nowrap text-[10px] text-on-surface-variant/45">
              {new Date(log.createdAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <p className="line-clamp-2 text-xs font-medium leading-5 text-on-surface">{summary}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-on-surface-variant/50">{actor}</p>
        </div>
      </div>
      {expanded && detailLines.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-outline-variant/10 pt-2">
          {detailLines.map((detail, index) => (
            <DetailRow key={`${detail.label}-${index}`} label={detail.label} value={detail.value} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AuditActionTabs({
  active,
  className,
  counts,
  desktopVariant = 'default',
  mobileTriggerVariant = 'surface',
  onChange,
}: {
  active: AuditActionTabValue;
  className?: string;
  counts: Record<AuditActionTabValue, number>;
  desktopVariant?: 'default' | 'subtle';
  mobileTriggerVariant?: 'plain' | 'surface';
  onChange: (value: AuditActionTabValue) => void;
}) {
  return (
    <ResponsiveSectionTabs
      tabs={ACTION_TABS.map((tab) => ({
        ...tab,
        count: counts[tab.value] ?? 0,
      }))}
      value={active}
      onChange={(value) => onChange(value as AuditActionTabValue)}
      mobileTitle="日志类型"
      mobileTriggerVariant={mobileTriggerVariant}
      desktopVariant={desktopVariant}
      countUnit="条"
      className={className}
    />
  );
}

function AuditHeaderActionTabs({
  active,
  onChange,
}: {
  active: AuditActionTabValue;
  onChange: (value: AuditActionTabValue) => void;
}) {
  return (
    <nav className="hidden min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 md:flex">
      {ACTION_TABS.map((tab) => {
        const isActive = active === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`group relative inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-semibold transition-colors after:absolute after:bottom-0 after:left-2 after:right-2 after:h-px after:rounded-full after:transition-opacity ${
              isActive
                ? 'text-primary-container after:bg-primary-container after:opacity-90'
                : 'text-on-surface-variant/78 after:bg-transparent after:opacity-0 hover:text-on-surface'
            }`}
          >
            <Icon
              name={tab.icon}
              size={15}
              className={isActive ? 'text-primary-container' : 'text-on-surface-variant/62 group-hover:text-on-surface'}
            />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ResourceFilterChips({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden border-t border-outline-variant/10 pt-2">
      <span className="hidden shrink-0 text-[11px] font-medium text-on-surface-variant/60 md:inline">资源范围</span>
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-none">
        {RESOURCE_FILTERS.map((item, index) => {
          const active = value === item.value;
          return (
            <Fragment key={item.value || 'all'}>
              {index > 0 ? <span className="mx-2 h-3 w-px shrink-0 bg-outline-variant/16" /> : null}
              <button
                type="button"
                onClick={() => onChange(item.value)}
                className={`group relative inline-flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-xs font-medium transition-colors ${
                  active ? 'text-primary-container' : 'text-on-surface-variant/70 hover:text-on-surface'
                }`}
              >
                <Icon
                  name={item.icon}
                  size={13}
                  className={
                    active ? 'text-primary-container/80' : 'text-on-surface-variant/45 group-hover:text-on-surface'
                  }
                />
                <span>{item.label}</span>
                {active ? (
                  <span className="absolute inset-x-1.5 bottom-0 h-px rounded-full bg-primary-container/70" />
                ) : null}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

function AdminSearchField({
  inputProps,
  value,
  onClear,
}: {
  inputProps: SearchInputProps;
  value: string;
  onClear: () => void;
}) {
  return (
    <SearchField
      inputProps={inputProps}
      value={value}
      onClear={onClear}
      placeholder="搜索用户、资源ID、路径"
      className="md:w-72 md:shrink-0"
    />
  );
}

function AuditToolbar({
  activeAction,
  actionCounts,
  actions,
  onActionChange,
  resource,
  onResourceChange,
  searchInputProps,
  searchInputValue,
  onClearSearch,
  total,
}: {
  activeAction: AuditActionTabValue;
  actionCounts: Record<AuditActionTabValue, number>;
  actions: ReactNode;
  onActionChange: (value: AuditActionTabValue) => void;
  resource: string;
  onResourceChange: (value: string) => void;
  searchInputProps: SearchInputProps;
  searchInputValue: string;
  onClearSearch: () => void;
  total: number;
}) {
  return (
    <div className="flex min-h-10 min-w-0 flex-col gap-2.5">
      <div className="md:hidden">
        <AuditActionTabs
          active={activeAction}
          counts={actionCounts}
          onChange={onActionChange}
          mobileTriggerVariant="surface"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <AdminSearchField inputProps={searchInputProps} value={searchInputValue} onClear={onClearSearch} />
          <span className="shrink-0 whitespace-nowrap text-xs text-on-surface-variant">
            当前结果 <strong className="text-on-surface tabular-nums">{total}</strong> 条
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      </div>
      <ResourceFilterChips value={resource} onChange={onResourceChange} />
    </div>
  );
}

function AuditRetentionDialog({
  policy,
  loading,
  selectedDays,
  saving,
  cleaning,
  onSelectDays,
  onSave,
  onCleanup,
  onClose,
}: {
  policy?: AuditRetentionPolicy;
  loading: boolean;
  selectedDays: number;
  saving: boolean;
  cleaning: boolean;
  onSelectDays: (value: number) => void;
  onSave: () => void;
  onCleanup: () => void;
  onClose: () => void;
}) {
  const currentDays = policy?.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  const changed = selectedDays !== currentDays;
  const deleteCount = policy?.deleteCount ?? 0;
  const cutoffLabel = policy?.cutoffAt ? formatDateTime(policy.cutoffAt) : '不清理历史日志';
  const cleanupDisabled = loading || changed || selectedDays <= 0 || deleteCount <= 0 || cleaning || saving;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-4 backdrop-blur-sm md:items-center">
      <div className="w-full max-w-lg rounded-lg border border-outline-variant/20 bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-outline-variant/10 px-5 py-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-container/10 text-primary-container">
            <Icon name="auto_delete" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-on-surface">日志保留策略</h2>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">
              设置操作日志保留时长，并可手动清理早于策略边界的历史记录。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="关闭保留策略"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {RETENTION_OPTIONS.map((option) => {
              const active = selectedDays === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onSelectDays(option.value)}
                  className={`min-h-[72px] rounded-lg border px-3 py-3 text-left transition-colors ${
                    active
                      ? 'border-primary-container/40 bg-primary-container/10 text-primary-container'
                      : 'border-outline-variant/15 text-on-surface hover:border-outline-variant/40 hover:bg-surface-container-high'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Icon name={active ? 'radio_button_checked' : 'radio_button_unchecked'} size={15} />
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-on-surface-variant">{option.description}</span>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
              <span>当前策略</span>
              <strong className="text-on-surface">{currentDays > 0 ? `保留 ${currentDays} 天` : '永久保留'}</strong>
              {changed ? <span className="text-amber-500">保存后重新计算可清理数量</span> : null}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
              <div>
                <span className="block text-on-surface-variant/60">清理边界</span>
                <span className="mt-1 block font-medium text-on-surface">{cutoffLabel}</span>
              </div>
              <div>
                <span className="block text-on-surface-variant/60">可清理日志</span>
                <span className="mt-1 block font-medium text-on-surface">
                  {loading ? '计算中...' : `${deleteCount} 条`}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-outline-variant/10 px-5 py-4 sm:flex-row sm:justify-end">
          <AdminButton
            onClick={onCleanup}
            disabled={cleanupDisabled}
            icon="delete_sweep"
            variant="danger"
            title={changed ? '请先保存保留策略' : undefined}
          >
            {cleaning ? '清理中...' : '立即清理'}
          </AdminButton>
          <AdminButton onClick={onSave} disabled={!changed || saving || cleaning} icon="save" variant="primary">
            {saving ? '保存中...' : '保存策略'}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}

function AuditLogContent() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { toast } = useToast();
  const [actionGroup, setActionGroup] = useState<AuditActionTabValue>('all');
  const [resource, setResource] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionDaysDraft, setRetentionDaysDraft] = useState(DEFAULT_AUDIT_RETENTION_DAYS);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionCleaning, setRetentionCleaning] = useState(false);
  const [retentionCleanupConfirmOpen, setRetentionCleanupConfirmOpen] = useState(false);
  const { counts, refreshCounts } = useAuditActionCounts(resource, search);
  const {
    data: retentionPolicy,
    isLoading: isRetentionLoading,
    mutate: refreshRetentionPolicy,
  } = useSWR('audit-retention-policy', fetchAuditRetentionPolicy);

  const { data, isLoading, setSize, size, mutate } = useSWRInfinite(
    (pageIndex, previousPageData: AuditPageResponse | null) => {
      if (previousPageData && previousPageData.page * AUDIT_PAGE_SIZE >= previousPageData.total) return null;
      return ['audit', actionGroup, resource, search, pageIndex + 1] as const;
    },
    ([, nextActionGroup, nextResource, nextSearch, nextPage]) =>
      fetchAuditLogs({
        page: nextPage,
        actionGroup: nextActionGroup,
        resource: nextResource,
        search: nextSearch,
      }),
  );

  useEffect(() => {
    setSize(1);
    setSelectedIds(new Set());
  }, [actionGroup, resource, search, setSize]);

  const pages = useMemo(() => data || [], [data]);
  const logs = useMemo(() => pages.flatMap((pageData) => pageData.items), [pages]);
  const loadedIdsKey = useMemo(() => logs.map((log) => log.id).join('|'), [logs]);
  const total = pages[0]?.total ?? counts?.[actionGroup] ?? 0;
  const selectedLogs = useMemo(() => logs.filter((log) => selectedIds.has(log.id)), [logs, selectedIds]);
  const selectedCount = selectedLogs.length;
  const hasMore = logs.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const actionCounts: Record<AuditActionTabValue, number> = {
    all: counts?.all ?? 0,
    create: counts?.create ?? 0,
    update: counts?.update ?? 0,
    delete: counts?.delete ?? 0,
    login: counts?.login ?? 0,
    download: counts?.download ?? 0,
    ticket: counts?.ticket ?? 0,
    settings: counts?.settings ?? 0,
  };
  const hasActiveFilter = actionGroup !== 'all' || Boolean(resource) || Boolean(search);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  useEffect(() => {
    const loadedIds = new Set(loadedIdsKey ? loadedIdsKey.split('|') : []);
    setSelectedIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => loadedIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [loadedIdsKey]);

  function toggleSelectMode() {
    setSelectMode((value) => {
      const next = !value;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportSelectedLogs() {
    if (selectedLogs.length === 0) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      filters: { actionGroup, resource: resource || 'all', search: search || '' },
      count: selectedLogs.length,
      items: selectedLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `audit_logs_${formatExportTimestamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${selectedLogs.length} 条日志`, 'success');
  }

  async function copySelectedIds() {
    if (selectedLogs.length === 0) return;
    try {
      await copyText(selectedLogs.map((log) => log.resourceId || log.id).join('\n'));
      toast('已复制所选日志 ID', 'success');
    } catch {
      toast('复制失败，请重试', 'error');
    }
  }

  async function handleRefresh() {
    try {
      await setSize(1);
      await Promise.all([
        mutate(undefined, { revalidate: true }),
        refreshCounts(undefined, { revalidate: true }),
        refreshRetentionPolicy(undefined, { revalidate: true }),
      ]);
      toast('操作日志已刷新', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '刷新操作日志失败'), 'error');
    }
  }

  function openRetentionPolicy() {
    setRetentionDaysDraft(retentionPolicy?.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS);
    setRetentionOpen(true);
  }

  async function handleSaveRetentionPolicy() {
    setRetentionSaving(true);
    try {
      await updateAuditRetentionPolicy(retentionDaysDraft);
      await refreshRetentionPolicy();
      toast('日志保留策略已保存', 'success');
    } catch {
      toast('保存保留策略失败，请重试', 'error');
    } finally {
      setRetentionSaving(false);
    }
  }

  async function handleCleanupByRetention() {
    if (retentionDaysDraft <= 0) {
      toast('当前为永久保留，无需清理', 'info');
      return;
    }
    const deleteCount = retentionPolicy?.deleteCount ?? 0;
    if (deleteCount <= 0) {
      toast('当前没有需要清理的日志', 'info');
      return;
    }
    setRetentionCleanupConfirmOpen(true);
  }

  async function handleConfirmCleanupByRetention() {
    setRetentionCleanupConfirmOpen(false);
    setRetentionCleaning(true);
    try {
      const result = await cleanupAuditLogsByRetention(retentionDaysDraft);
      await Promise.all([mutate(), refreshCounts(), refreshRetentionPolicy()]);
      toast(`已清理 ${result.deleted} 条操作日志`, 'success');
    } catch {
      toast('清理日志失败，请重试', 'error');
    } finally {
      setRetentionCleaning(false);
    }
  }

  const actions = (
    <div className="flex items-center gap-2">
      <AdminRefreshButton onRefresh={handleRefresh} mobileIconOnly />
      <AdminButton onClick={openRetentionPolicy} icon="auto_delete" size={isDesktop ? 'md' : 'sm'} variant="secondary">
        {isDesktop ? '保留策略' : '策略'}
      </AdminButton>
      {total > 0 ? (
        <AdminButton
          onClick={toggleSelectMode}
          active={selectMode}
          icon={selectMode ? 'close' : 'checklist'}
          size={isDesktop ? 'md' : 'sm'}
          variant="secondary"
        >
          {isDesktop ? (selectMode ? '取消选择' : '批量操作') : selectMode ? '取消' : '批量'}
        </AdminButton>
      ) : null}
    </div>
  );
  const toolbar = (
    <AuditToolbar
      activeAction={actionGroup}
      actionCounts={actionCounts}
      actions={actions}
      onActionChange={setActionGroup}
      resource={resource}
      onResourceChange={setResource}
      searchInputProps={searchInputProps}
      searchInputValue={searchInputValue}
      onClearSearch={() => setSearch('')}
      total={total}
    />
  );
  const headerNavigation = <AuditHeaderActionTabs active={actionGroup} onChange={setActionGroup} />;

  const body = (
    <AdminContentPanel scroll className={isDesktop ? 'h-full overflow-hidden' : undefined}>
      {isLoading && logs.length === 0 ? (
        <AdminLoadingState
          rows={isDesktop ? 10 : 8}
          tableColumns={isDesktop ? '96px 112px minmax(0,1fr) 160px 180px' : undefined}
          tableCells={isDesktop ? ['chip', 'chip', 'text', 'text', 'text'] : undefined}
          variant={isDesktop ? undefined : 'list'}
          className={isDesktop ? 'h-full rounded-none border-0' : 'min-h-[320px]'}
          label="操作日志加载中"
        />
      ) : null}
      {logs.length > 0 && isDesktop ? (
        <div className="h-full overflow-auto custom-scrollbar">
          <AdminTable>
            <thead className={ADMIN_TABLE_HEAD_CLASS}>
              <AdminTableHeadRow>
                {selectMode ? <AdminTableHeadCell className="w-10" /> : null}
                <AdminTableHeadCell>操作</AdminTableHeadCell>
                <AdminTableHeadCell>资源</AdminTableHeadCell>
                <AdminTableHeadCell>详情</AdminTableHeadCell>
                <AdminTableHeadCell>用户</AdminTableHeadCell>
                <AdminTableHeadCell>时间</AdminTableHeadCell>
              </AdminTableHeadRow>
            </thead>
            <tbody>
              {logs.map((log) => (
                <LogRow
                  key={log.id}
                  log={log}
                  isDesktop
                  selectMode={selectMode}
                  selected={selectedIds.has(log.id)}
                  onToggleSelect={toggleSelected}
                />
              ))}
              <AdminTableBodyRow className="hover:bg-transparent">
                <AdminTableCell colSpan={selectMode ? 6 : 5}>
                  <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
                </AdminTableCell>
              </AdminTableBodyRow>
            </tbody>
          </AdminTable>
        </div>
      ) : null}
      {logs.length > 0 && !isDesktop ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3 scrollbar-hidden">
          {logs.map((log) => (
            <LogRow
              key={log.id}
              log={log}
              isDesktop={false}
              selectMode={selectMode}
              selected={selectedIds.has(log.id)}
              onToggleSelect={toggleSelected}
            />
          ))}
          <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
        </div>
      ) : null}
      {logs.length === 0 && !isLoading ? (
        <AdminEmptyState
          icon={hasActiveFilter ? 'search_off' : 'schedule'}
          title={hasActiveFilter ? '没有匹配的日志' : '暂无操作日志'}
          description={
            hasActiveFilter
              ? '请换个关键词，或切换日志类型和资源筛选。'
              : '后台操作、登录、下载和数据变更记录会显示在这里。'
          }
          className={isDesktop ? undefined : 'min-h-[320px] md:min-h-[360px]'}
        />
      ) : null}
    </AdminContentPanel>
  );

  return (
    <AdminManagementPage
      title="操作日志"
      description="查看后台操作、登录、下载和数据变更记录"
      headerNavigation={headerNavigation}
      toolbar={toolbar}
      contentClassName="min-h-0 overflow-hidden"
    >
      {retentionOpen ? (
        <AuditRetentionDialog
          policy={retentionPolicy}
          loading={isRetentionLoading}
          selectedDays={retentionDaysDraft}
          saving={retentionSaving}
          cleaning={retentionCleaning}
          onSelectDays={setRetentionDaysDraft}
          onSave={handleSaveRetentionPolicy}
          onCleanup={handleCleanupByRetention}
          onClose={() => setRetentionOpen(false)}
        />
      ) : null}
      <ConfirmDialog
        open={retentionCleanupConfirmOpen}
        onClose={() => setRetentionCleanupConfirmOpen(false)}
        onConfirm={() => void handleConfirmCleanupByRetention()}
        icon="auto_delete"
        title="确认清理日志"
        description={`确认清理 ${retentionPolicy?.deleteCount ?? 0} 条早于 ${
          retentionPolicy?.cutoffAt ? formatDateTime(retentionPolicy.cutoffAt) : '保留截止时间'
        } 的操作日志吗？清理后不可恢复。`}
        confirmLabel={retentionCleaning ? '清理中...' : '确认清理'}
        confirmDisabled={retentionCleaning}
      />
      {selectMode && selectedCount > 0 ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-on-surface">已选 {selectedCount} 条</span>
          <div className="flex-1" />
          <AdminButton onClick={exportSelectedLogs} icon="download" size="sm" variant="tonal">
            导出所选
          </AdminButton>
          <AdminButton onClick={copySelectedIds} icon="content_copy" size="sm" variant="secondary">
            复制ID
          </AdminButton>
          <AdminIconButton
            onClick={() => {
              setSelectMode(false);
              setSelectedIds(new Set());
            }}
            icon="close"
            size="icon-sm"
            variant="ghost"
            aria-label="取消选择"
          />
        </div>
      ) : null}
      {body}
    </AdminManagementPage>
  );
}

export default function AuditLogPage() {
  useDocumentTitle('操作日志');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <AdminPageShell desktopContentClassName="min-h-0 overflow-hidden">
        <AuditLogContent />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      mobileMainClassName="min-h-0 overflow-hidden"
      mobileContentClassName="flex h-full min-h-0 flex-col px-4 py-4 pb-20"
    >
      <AuditLogContent />
    </AdminPageShell>
  );
}
