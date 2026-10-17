import { Fragment, useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import client from '../api/client';
import { unwrapResponse } from '../api/response';
import { AdminButton, AdminIconButton } from '../components/shared/AdminControls';
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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

type AuditDetails = {
  body?: Record<string, unknown>;
  method?: string;
  path?: string;
  statusCode?: number;
  status?: string;
  riskLevel?: string;
  summary?: string;
  message?: string;
  error?: string;
  jobId?: string;
  source?: string;
  scopeLabel?: string;
  modelCount?: number;
  thumbnailCount?: number;
  fileSizeText?: string;
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
  { value: 0, labelKey: 'auditLog.retention.forever.label', descriptionKey: 'auditLog.retention.forever.description' },
  { value: 90, labelKey: 'auditLog.retention.90.label', descriptionKey: 'auditLog.retention.90.description' },
  { value: 180, labelKey: 'auditLog.retention.180.label', descriptionKey: 'auditLog.retention.180.description' },
  { value: 365, labelKey: 'auditLog.retention.365.label', descriptionKey: 'auditLog.retention.365.description' },
];

const ACTION_COLORS: Record<string, string> = {
  create: 'text-green-500 bg-green-500/10',
  upload: 'text-green-500 bg-green-500/10',
  update: 'text-blue-500 bg-blue-500/10',
  delete: 'text-red-500 bg-red-500/10',
  login: 'text-amber-500 bg-amber-500/10',
  download: 'text-purple-500 bg-purple-500/10',
  register: 'text-teal-500 bg-teal-500/10',
  settings_update: 'text-cyan-500 bg-cyan-500/10',
  favorite: 'text-pink-500 bg-pink-500/10',
  unfavorite: 'text-on-surface-variant bg-surface-container-highest',
  comment: 'text-indigo-500 bg-indigo-500/10',
  ticket_create: 'text-primary-container bg-primary-container/10',
  ticket_reply: 'text-blue-500 bg-blue-500/10',
  ticket_status: 'text-amber-500 bg-amber-500/10',
  backup_create: 'text-cyan-500 bg-cyan-500/10',
  backup_policy_check: 'text-orange-500 bg-orange-500/10',
  backup_verify: 'text-teal-500 bg-teal-500/10',
  backup_restore_result: 'text-amber-500 bg-amber-500/10',
  backup_restore: 'text-amber-500 bg-amber-500/10',
  backup_import_restore: 'text-amber-500 bg-amber-500/10',
  backup_import_save: 'text-cyan-500 bg-cyan-500/10',
  backup_delete: 'text-red-500 bg-red-500/10',
  backup_download: 'text-purple-500 bg-purple-500/10',
  backup_rename: 'text-blue-500 bg-blue-500/10',
  system_update: 'text-cyan-500 bg-cyan-500/10',
  audit_cleanup: 'text-amber-500 bg-amber-500/10',
};

const RESOURCE_KEYS: Record<string, string> = {
  model: 'auditLog.resource.model',
  user: 'auditLog.resource.user',
  settings: 'auditLog.resource.settings',
  category: 'auditLog.resource.category',
  comment: 'auditLog.resource.comment',
  auth: 'auditLog.resource.auth',
  ticket: 'auditLog.resource.ticket',
  favorite: 'auditLog.resource.favorite',
  download: 'auditLog.resource.download',
  share: 'auditLog.resource.share',
  backup: 'auditLog.resource.backup',
  audit: 'auditLog.resource.audit',
  project: 'auditLog.resource.project',
  other: 'auditLog.resource.other',
};

const ACTION_TABS: Array<{ value: AuditActionTabValue; labelKey: string; icon: string }> = [
  { value: 'all', labelKey: 'auditLog.tab.all', icon: 'format_list_bulleted' },
  { value: 'create', labelKey: 'auditLog.tab.create', icon: 'add_circle' },
  { value: 'update', labelKey: 'auditLog.tab.update', icon: 'edit' },
  { value: 'delete', labelKey: 'auditLog.tab.delete', icon: 'delete' },
  { value: 'login', labelKey: 'auditLog.tab.login', icon: 'login' },
  { value: 'download', labelKey: 'auditLog.tab.download', icon: 'download' },
  { value: 'ticket', labelKey: 'auditLog.tab.ticket', icon: 'build' },
  { value: 'settings', labelKey: 'auditLog.tab.settings', icon: 'settings' },
];

const RESOURCE_FILTERS: Array<{ value: string; labelKey: string; icon: string }> = [
  { value: '', labelKey: 'auditLog.filter.all', icon: 'apps' },
  { value: 'model', labelKey: 'auditLog.resource.model', icon: 'view_in_ar' },
  { value: 'user', labelKey: 'auditLog.resource.user', icon: 'person' },
  { value: 'category', labelKey: 'auditLog.resource.category', icon: 'folder' },
  { value: 'auth', labelKey: 'auditLog.resource.auth', icon: 'login' },
  { value: 'ticket', labelKey: 'auditLog.resource.ticket', icon: 'build' },
  { value: 'favorite', labelKey: 'auditLog.resource.favorite', icon: 'star' },
  { value: 'download', labelKey: 'auditLog.resource.download', icon: 'download' },
  { value: 'share', labelKey: 'auditLog.resource.share', icon: 'share' },
  { value: 'settings', labelKey: 'auditLog.filter.settings', icon: 'settings' },
  { value: 'backup', labelKey: 'auditLog.resource.backup', icon: 'database' },
  { value: 'audit', labelKey: 'auditLog.resource.audit', icon: 'policy' },
];

const BODY_LABELS: Record<string, string> = {
  name: 'auditLog.body.name',
  title: 'auditLog.body.title',
  status: 'auditLog.body.status',
  classification: 'auditLog.body.classification',
  description: 'auditLog.body.description',
  role: 'auditLog.body.role',
  email: 'auditLog.body.email',
  username: 'auditLog.body.username',
  format: 'auditLog.body.format',
  content: 'auditLog.body.content',
  retentionDays: 'auditLog.body.retentionDays',
  cutoffAt: 'auditLog.body.cutoffAt',
  deleted: 'auditLog.body.deleted',
  source: 'auditLog.body.source',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN');
}

function formatExportTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function actionColor(action: string) {
  return ACTION_COLORS[action] || 'text-on-surface-variant bg-surface-container-highest';
}

function resourceLabel(resource: string, t: TFunction) {
  return t(RESOURCE_KEYS[resource] || '', { defaultValue: resource });
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

function getLogDetails(log: AuditEntry, t: TFunction) {
  const detailLines: { label: string; value: string }[] = [];
  if (log.resourceId) detailLines.push({ label: t('auditLog.detail.resourceId'), value: log.resourceId });
  if (log.details?.body) {
    for (const [key, rawValue] of Object.entries(log.details.body)) {
      const value = valueToText(rawValue);
      if (!value) continue;
      detailLines.push({ label: t(BODY_LABELS[key] || '', { defaultValue: key }), value: value.slice(0, 160) });
    }
  }
  if (log.details?.method) detailLines.push({ label: t('auditLog.detail.method'), value: log.details.method });
  if (log.details?.path) detailLines.push({ label: t('auditLog.detail.path'), value: log.details.path });
  if (log.details?.statusCode)
    detailLines.push({ label: t('auditLog.detail.statusCode'), value: String(log.details.statusCode) });
  if (log.details?.status) detailLines.push({ label: t('auditLog.detail.result'), value: log.details.status });
  if (log.details?.riskLevel) detailLines.push({ label: t('auditLog.detail.riskLevel'), value: log.details.riskLevel });
  if (log.details?.scopeLabel) detailLines.push({ label: t('auditLog.detail.scope'), value: log.details.scopeLabel });
  if (log.details?.fileSizeText)
    detailLines.push({ label: t('auditLog.detail.fileSize'), value: log.details.fileSizeText });
  if (typeof log.details?.modelCount === 'number')
    detailLines.push({ label: t('auditLog.detail.modelCount'), value: String(log.details.modelCount) });
  if (typeof log.details?.thumbnailCount === 'number') {
    detailLines.push({ label: t('auditLog.detail.thumbnailCount'), value: String(log.details.thumbnailCount) });
  }
  if (log.details?.jobId) detailLines.push({ label: t('auditLog.detail.jobId'), value: log.details.jobId });
  return detailLines;
}

function getLogSummary(log: AuditEntry, t: TFunction) {
  const body = log.details?.body;
  const primary = valueToText(body?.title || body?.name || body?.description || body?.status || body?.classification);
  if (primary) return primary;
  if (log.details?.summary) return log.details.summary;
  if (log.details?.message) return log.details.message;
  if (log.details?.error) return log.details.error;
  if (log.details?.path) return log.details.path;
  if (log.resourceId) return log.resourceId;
  return t('auditLog.noDetails');
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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded border transition-colors ${
        checked
          ? 'border-primary-container bg-primary-container text-on-primary'
          : 'border-outline-variant/35 text-transparent hover:border-primary-container/50'
      }`}
      aria-label={checked ? t('auditLog.deselectLog') : t('auditLog.selectLog')}
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
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const actColor = actionColor(log.action);
  const actLabel = t(`auditLog.action.${log.action}`, { defaultValue: log.action });
  const resLabel = resourceLabel(log.resource, t);
  const detailLines = getLogDetails(log, t);
  const summary = getLogSummary(log, t);
  const actor = log.username || (log.userId ? `${log.userId.slice(0, 8)}...` : t('auditLog.systemActor'));

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
            <span className={`rounded-sm px-2 py-0.5 text-[10px] font-medium ${actColor}`}>{actLabel}</span>
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
            <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold ${actColor}`}>{actLabel}</span>
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
  const { t } = useTranslation();
  return (
    <ResponsiveSectionTabs
      tabs={ACTION_TABS.map((tab) => ({
        value: tab.value,
        label: t(tab.labelKey),
        icon: tab.icon,
        count: counts[tab.value] ?? 0,
      }))}
      value={active}
      onChange={(value) => onChange(value as AuditActionTabValue)}
      mobileTitle={t('auditLog.mobileTabsTitle')}
      mobileTriggerVariant={mobileTriggerVariant}
      desktopVariant={desktopVariant}
      countUnit={t('auditLog.logCountUnit')}
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
  const { t } = useTranslation();
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
            <span>{t(tab.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ResourceFilterChips({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden border-t border-outline-variant/10 pt-2">
      <span className="hidden shrink-0 text-[11px] font-medium text-on-surface-variant/60 md:inline">
        {t('auditLog.resourceScope')}
      </span>
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
                <span>{t(item.labelKey)}</span>
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
  const { t } = useTranslation();
  return (
    <SearchField
      inputProps={inputProps}
      value={value}
      onClear={onClear}
      placeholder={t('auditLog.searchPlaceholder')}
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
  const { t } = useTranslation();
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
            {t('auditLog.currentResults')} <strong className="text-on-surface tabular-nums">{total}</strong>
            {t('auditLog.resultUnit')}
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
  const { t } = useTranslation();
  const currentDays = policy?.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS;
  const changed = selectedDays !== currentDays;
  const deleteCount = policy?.deleteCount ?? 0;
  const cutoffLabel = policy?.cutoffAt ? formatDateTime(policy.cutoffAt) : t('auditLog.retention.noCleanup');
  const cleanupDisabled = loading || changed || selectedDays <= 0 || deleteCount <= 0 || cleaning || saving;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 py-4 backdrop-blur-sm md:items-center">
      <div className="w-full max-w-lg rounded-lg border border-outline-variant/20 bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-outline-variant/10 px-5 py-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-container/10 text-primary-container">
            <Icon name="auto_delete" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-on-surface">{t('auditLog.retention.title')}</h2>
            <p className="mt-1 text-xs leading-5 text-on-surface-variant">{t('auditLog.retention.description')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label={t('auditLog.retention.closeAria')}
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
                    {t(option.labelKey)}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-on-surface-variant">
                    {t(option.descriptionKey)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-outline-variant/15 bg-surface-container-low px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
              <span>{t('auditLog.retention.currentPolicy')}</span>
              <strong className="text-on-surface">
                {currentDays > 0
                  ? t('auditLog.retention.keepDays', { count: currentDays })
                  : t('auditLog.retention.forever.label')}
              </strong>
              {changed ? <span className="text-amber-500">{t('auditLog.retention.recalcHint')}</span> : null}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-on-surface-variant sm:grid-cols-2">
              <div>
                <span className="block text-on-surface-variant/60">{t('auditLog.detail.cutoffAt')}</span>
                <span className="mt-1 block font-medium text-on-surface">{cutoffLabel}</span>
              </div>
              <div>
                <span className="block text-on-surface-variant/60">{t('auditLog.retention.cleanableLogs')}</span>
                <span className="mt-1 block font-medium text-on-surface">
                  {loading
                    ? t('auditLog.retention.computing')
                    : t('auditLog.retention.countUnitRecords', { count: deleteCount })}
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
            title={changed ? t('auditLog.retention.saveFirstHint') : undefined}
          >
            {cleaning ? t('auditLog.retention.cleaning') : t('auditLog.retention.cleanupNow')}
          </AdminButton>
          <AdminButton onClick={onSave} disabled={!changed || saving || cleaning} icon="save" variant="primary">
            {saving ? t('auditLog.retention.savingPolicy') : t('auditLog.retention.savePolicy')}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}

function AuditLogContent() {
  const { t } = useTranslation();
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
    // 延迟回收：同步 revoke 可能赶在浏览器异步读取 blob 前，下载内容被截断
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast(t('auditLog.exportToast', { count: selectedLogs.length }), 'success');
  }

  async function copySelectedIds() {
    if (selectedLogs.length === 0) return;
    try {
      await copyText(selectedLogs.map((log) => log.resourceId || log.id).join('\n'));
      toast(t('auditLog.copiedIds'), 'success');
    } catch {
      toast(t('auditLog.copyRetryFailed'), 'error');
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
      toast(t('auditLog.refreshed'), 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, t('auditLog.refreshFailed')), 'error');
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
      toast(t('auditLog.retention.policySaved'), 'success');
    } catch {
      toast(t('auditLog.retention.policySaveFailed'), 'error');
    } finally {
      setRetentionSaving(false);
    }
  }

  async function handleCleanupByRetention() {
    if (retentionDaysDraft <= 0) {
      toast(t('auditLog.retention.keepForeverNoClean'), 'info');
      return;
    }
    const deleteCount = retentionPolicy?.deleteCount ?? 0;
    if (deleteCount <= 0) {
      toast(t('auditLog.retention.nothingToClean'), 'info');
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
      toast(t('auditLog.retention.cleanedToast', { count: result.deleted }), 'success');
    } catch {
      toast(t('auditLog.retention.cleanFailed'), 'error');
    } finally {
      setRetentionCleaning(false);
    }
  }

  const actions = (
    <div className="flex items-center gap-2">
      <AdminRefreshButton onRefresh={handleRefresh} mobileIconOnly />
      <AdminButton onClick={openRetentionPolicy} icon="auto_delete" size={isDesktop ? 'md' : 'sm'} variant="secondary">
        {isDesktop ? t('auditLog.btnRetention') : t('auditLog.btnRetentionShort')}
      </AdminButton>
      {total > 0 ? (
        <AdminButton
          onClick={toggleSelectMode}
          active={selectMode}
          icon={selectMode ? 'close' : 'checklist'}
          size={isDesktop ? 'md' : 'sm'}
          variant="secondary"
        >
          {isDesktop
            ? selectMode
              ? t('auditLog.cancelSelection')
              : t('auditLog.btnBatch')
            : selectMode
              ? t('common.cancel')
              : t('auditLog.btnBatchShort')}
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
          label={t('auditLog.loadingLabel')}
        />
      ) : null}
      {logs.length > 0 && isDesktop ? (
        <div className="h-full overflow-auto custom-scrollbar">
          <AdminTable>
            <thead className={ADMIN_TABLE_HEAD_CLASS}>
              <AdminTableHeadRow>
                {selectMode ? <AdminTableHeadCell className="w-10" /> : null}
                <AdminTableHeadCell>{t('auditLog.tableHead.action')}</AdminTableHeadCell>
                <AdminTableHeadCell>{t('auditLog.tableHead.resource')}</AdminTableHeadCell>
                <AdminTableHeadCell>{t('auditLog.tableHead.detail')}</AdminTableHeadCell>
                <AdminTableHeadCell>{t('common.user')}</AdminTableHeadCell>
                <AdminTableHeadCell>{t('auditLog.tableHead.time')}</AdminTableHeadCell>
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
          title={hasActiveFilter ? t('auditLog.emptyFilterTitle') : t('auditLog.emptyTitle')}
          description={hasActiveFilter ? t('auditLog.emptyFilterDescription') : t('auditLog.emptyDescription')}
          className={isDesktop ? undefined : 'min-h-[320px] md:min-h-[360px]'}
        />
      ) : null}
    </AdminContentPanel>
  );

  return (
    <AdminManagementPage
      title={t('auditLog.pageTitle')}
      description={t('auditLog.pageDescription')}
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
        title={t('auditLog.cleanupTitle')}
        description={t('auditLog.cleanupDescription', {
          count: retentionPolicy?.deleteCount ?? 0,
          cutoff: retentionPolicy?.cutoffAt ? formatDateTime(retentionPolicy.cutoffAt) : t('auditLog.noCleanupDate'),
        })}
        confirmLabel={retentionCleaning ? t('auditLog.retention.cleaning') : t('auditLog.cleanupConfirm')}
        confirmDisabled={retentionCleaning}
      />
      {selectMode && selectedCount > 0 ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-outline-variant/20 bg-surface-container-high px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-on-surface">
            {t('auditLog.batchSelected', { count: selectedCount })}
          </span>
          <div className="flex-1" />
          <AdminButton onClick={exportSelectedLogs} icon="download" size="sm" variant="tonal">
            {t('auditLog.exportSelected')}
          </AdminButton>
          <AdminButton onClick={copySelectedIds} icon="content_copy" size="sm" variant="secondary">
            {t('auditLog.copyIds')}
          </AdminButton>
          <AdminIconButton
            onClick={() => {
              setSelectMode(false);
              setSelectedIds(new Set());
            }}
            icon="close"
            size="icon-sm"
            variant="ghost"
            aria-label={t('auditLog.cancelSelection')}
          />
        </div>
      ) : null}
      {body}
    </AdminManagementPage>
  );
}

export default function AuditLogPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('auditLog.pageTitle'));
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
      mobileContentClassName="flex h-full min-h-0 flex-col px-4 py-4 pb-safe-nav"
    >
      <AuditLogContent />
    </AdminPageShell>
  );
}
