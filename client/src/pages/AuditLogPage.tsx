import { useCallback, useEffect, useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AdminManagementPage, AdminContentPanel, AdminEmptyState } from '../components/shared/AdminManagementPage';
import Icon from '../components/shared/Icon';
import client from '../api/client';
import { unwrapResponse } from '../api/response';

type AuditDetails = {
  body?: {
    name?: string;
    status?: string;
    content?: string;
  };
  path?: string;
  statusCode?: number;
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
};

const AUDIT_PAGE_SIZE = 30;

async function fetchAuditLogs(page: number, filterAction: string, filterResource: string) {
  const params: Record<string, string | number> = { page, size: AUDIT_PAGE_SIZE };
  if (filterAction) params.action = filterAction;
  if (filterResource) params.resource = filterResource;
  return client
    .get('/audit', { params })
    .then((response) => unwrapResponse<{ total: number; items: AuditEntry[]; page: number }>(response));
}

function DetailRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-on-surface-variant/60 shrink-0 w-14">{label}</span>
      <span className={`text-on-surface-variant min-w-0 break-all ${compact ? 'line-clamp-2' : ''}`}>{value}</span>
    </div>
  );
}

function LogRow({ log, isDesktop }: { log: AuditEntry; isDesktop: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const act = ACTION_MAP[log.action] || {
    label: log.action,
    color: 'text-on-surface-variant bg-surface-container-highest',
  };
  const resLabel = RESOURCE_MAP[log.resource] || log.resource;

  const detailLines: { label: string; value: string }[] = [];
  if (log.resourceId) detailLines.push({ label: '资源ID', value: log.resourceId });
  if (log.details?.body) {
    const body = log.details.body;
    if (body.name) detailLines.push({ label: '名称', value: body.name });
    if (body.status) detailLines.push({ label: '状态', value: body.status });
    if (body.content) detailLines.push({ label: '内容', value: String(body.content).slice(0, 100) });
  }
  if (log.details?.path) detailLines.push({ label: '路径', value: log.details.path });
  if (log.details?.statusCode) detailLines.push({ label: '状态码', value: String(log.details.statusCode) });

  if (isDesktop) {
    return (
      <>
        <tr
          className="border-b border-outline-variant/5 hover:bg-surface-container-high/30 cursor-pointer transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <td className="py-2 px-4">
            <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${act.color}`}>{act.label}</span>
          </td>
          <td className="py-2 px-4 text-xs text-on-surface-variant">{resLabel}</td>
          <td
            className="py-2 px-4 text-xs text-on-surface-variant/60 font-mono max-w-[160px] truncate"
            title={log.resourceId || ''}
          >
            {log.resourceId || '—'}
          </td>
          <td className="py-2 px-4 text-xs text-on-surface-variant/60">
            {log.username || (log.userId ? log.userId.slice(0, 8) + '...' : '系统')}
          </td>
          <td className="py-2 px-4 text-xs text-on-surface-variant/40 whitespace-nowrap">
            {new Date(log.createdAt).toLocaleString('zh-CN')}
          </td>
        </tr>
        {expanded && detailLines.length > 0 && (
          <tr className="border-b border-outline-variant/5 bg-surface-container-high/20">
            <td colSpan={5} className="px-4 py-2">
              <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                {detailLines.map((d, i) => (
                  <DetailRow key={i} label={d.label} value={d.value} compact />
                ))}
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <div
      className="rounded-lg border border-outline-variant/10 bg-surface-container-low p-3 cursor-pointer active:bg-surface-container-high transition-colors"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className={`text-[10px] px-2 py-0.5 rounded-sm font-bold ${act.color}`}>{act.label}</span>
        <span className="text-[10px] text-on-surface-variant bg-surface-container-highest px-1.5 py-0.5 rounded-sm">
          {resLabel}
        </span>
        <span className="text-[10px] text-on-surface-variant/40 ml-auto whitespace-nowrap">
          {new Date(log.createdAt).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {log.resourceId && (
        <p className="line-clamp-2 text-[11px] text-on-surface-variant/50 font-mono break-all">ID: {log.resourceId}</p>
      )}
      {expanded && detailLines.length > 0 && (
        <div className="mt-2 pt-2 border-t border-outline-variant/10 space-y-1">
          {detailLines.map((d, i) => (
            <DetailRow key={i} label={d.label} value={d.value} compact />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuditLogPage() {
  useDocumentTitle('操作日志');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [filterAction, setFilterAction] = useState('');
  const [filterResource, setFilterResource] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, setSize, size } = useSWRInfinite(
    (pageIndex, previousPageData: { total: number; items: AuditEntry[]; page: number } | null) => {
      if (previousPageData && previousPageData.page * AUDIT_PAGE_SIZE >= previousPageData.total) return null;
      return ['/audit', filterAction, filterResource, pageIndex + 1] as const;
    },
    ([, action, resource, nextPage]) => fetchAuditLogs(nextPage, action, resource),
  );

  useEffect(() => {
    setSize(1);
  }, [filterAction, filterResource, setSize]);

  const pages = data || [];
  const logs = pages.flatMap((pageData) => pageData.items);
  const searchText = search.trim().toLowerCase();
  const visibleLogs = searchText
    ? logs.filter((log) => {
        const body = log.details?.body;
        const haystack = [
          log.id,
          log.username,
          log.userId,
          log.action,
          ACTION_MAP[log.action]?.label,
          log.resource,
          RESOURCE_MAP[log.resource],
          log.resourceId,
          log.details?.path,
          log.details?.statusCode,
          body?.name,
          body?.status,
          body?.content,
          log.createdAt,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchText);
      })
    : logs;
  const total = pages[0]?.total || 0;
  const hasMore = logs.length < total;
  const isLoadingMore = Boolean(size > 0 && !data?.[size - 1]);
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    setSize((current) => current + 1);
  }, [hasMore, isLoadingMore, setSize]);

  const filterBar = (
    <div className="grid min-h-11 items-center gap-3 md:grid-cols-[minmax(0,auto)_minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 grid-cols-2 items-center gap-0 md:inline-flex md:grid-cols-none">
        {[
          {
            value: filterAction,
            onChange: setFilterAction,
            label: '操作',
            allLabel: '全部操作',
            options: Object.entries(ACTION_MAP).map(([value, item]) => ({ value, label: item.label })),
          },
          {
            value: filterResource,
            onChange: setFilterResource,
            label: '资源',
            allLabel: '全部资源',
            options: Object.entries(RESOURCE_MAP).map(([value, label]) => ({ value, label })),
          },
        ].map((filter, index) => (
          <div
            key={filter.label}
            className={`relative inline-flex h-9 min-w-0 items-center justify-center text-sm font-medium leading-none transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full md:w-[7.25rem] ${
              filter.value
                ? 'text-primary-container after:bg-primary-container'
                : 'text-on-surface-variant after:bg-transparent hover:text-on-surface'
            }`}
          >
            {index > 0 ? (
              <span className="absolute left-0 top-1/2 hidden h-3.5 w-px -translate-y-1/2 bg-outline-variant/20 md:block" />
            ) : null}
            <select
              value={filter.value}
              onChange={(event) => filter.onChange(event.target.value)}
              aria-label={filter.label}
              className="relative z-10 h-full w-full cursor-pointer appearance-none truncate border-0 bg-transparent pl-3 pr-7 text-center outline-none [text-align-last:center]"
            >
              <option value="">{filter.allLabel}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Icon
              name="expand_more"
              size={14}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-current opacity-60"
            />
          </div>
        ))}
      </div>

      <div className="flex min-w-0 items-center gap-3 overflow-x-auto scrollbar-none text-xs text-on-surface-variant md:justify-end">
        <span className="whitespace-nowrap">
          共 <strong className="text-on-surface tabular-nums">{total}</strong> 条
        </span>
        {searchText ? (
          <>
            <span className="h-3 w-px shrink-0 bg-outline-variant/20" />
            <span className="whitespace-nowrap">
              匹配 <strong className="text-on-surface tabular-nums">{visibleLogs.length}</strong> 条
            </span>
          </>
        ) : null}
        {filterAction || filterResource ? (
          <>
            <span className="h-3 w-px shrink-0 bg-outline-variant/20" />
            <button
              onClick={() => {
                setFilterAction('');
                setFilterResource('');
              }}
              className="shrink-0 text-xs font-semibold text-primary-container transition-colors hover:text-on-surface"
            >
              清除筛选
            </button>
          </>
        ) : null}
      </div>

      <div className="flex h-9 w-full min-w-0 items-center rounded-sm border border-outline-variant/15 bg-surface-container px-3 md:w-72">
        <Icon name="search" size={15} className="mr-2 shrink-0 text-on-surface-variant" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索用户、资源ID、内容"
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-on-surface outline-none placeholder:text-on-surface-variant/50"
        />
        {search && (
          <button onClick={() => setSearch('')} className="p-0.5 text-on-surface-variant hover:text-on-surface">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <AdminPageShell desktopContentClassName="min-h-0 overflow-hidden">
        <AdminManagementPage
          title="操作日志"
          description="查看后台操作、登录、下载和数据变更记录"
          toolbar={filterBar}
          contentClassName="min-h-0 overflow-hidden"
        >
          <AdminContentPanel scroll className="h-full overflow-hidden">
            <div className="h-full overflow-auto custom-scrollbar">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-container-low text-xs uppercase tracking-wider text-on-surface-variant font-bold">
                    <th className="py-3 px-4 text-left">操作</th>
                    <th className="py-3 px-4 text-left">资源</th>
                    <th className="py-3 px-4 text-left">资源ID</th>
                    <th className="py-3 px-4 text-left">用户</th>
                    <th className="py-3 px-4 text-left">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLogs.map((log) => (
                    <LogRow key={log.id} log={log} isDesktop />
                  ))}
                  {logs.length > 0 && !searchText && (
                    <tr>
                      <td colSpan={5}>
                        <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {isLoading && logs.length === 0 && (
              <div className="flex min-h-[360px] items-center justify-center text-sm text-on-surface-variant">
                加载中...
              </div>
            )}
            {visibleLogs.length === 0 && !isLoading && (
              <AdminEmptyState
                icon={searchText ? 'search_off' : 'schedule'}
                title={searchText ? '没有匹配的日志' : '暂无操作日志'}
                description={
                  searchText ? '请换个关键词，或清空搜索后再看。' : '后台操作、登录、下载和数据变更记录会显示在这里。'
                }
              />
            )}
          </AdminContentPanel>
        </AdminManagementPage>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      mobileMainClassName="min-h-0 overflow-hidden"
      mobileContentClassName="flex h-full min-h-0 flex-col px-4 py-4 pb-20"
    >
      <AdminManagementPage
        title="操作日志"
        description="查看后台操作、登录、下载和数据变更记录"
        toolbar={filterBar}
        contentClassName="min-h-0 overflow-hidden"
      >
        <AdminContentPanel scroll>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden flex flex-col gap-2 p-3">
            {visibleLogs.map((log) => (
              <LogRow key={log.id} log={log} isDesktop={false} />
            ))}
            {logs.length > 0 && !searchText && (
              <InfiniteLoadTrigger hasMore={hasMore} isLoading={isLoadingMore} onLoadMore={loadMore} />
            )}
            {isLoading && logs.length === 0 && (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-on-surface-variant">
                加载中...
              </div>
            )}
            {visibleLogs.length === 0 && !isLoading && (
              <AdminEmptyState
                icon={searchText ? 'search_off' : 'schedule'}
                title={searchText ? '没有匹配的日志' : '暂无操作日志'}
                description={
                  searchText ? '请换个关键词，或清空搜索后再看。' : '后台操作、登录、下载和数据变更记录会显示在这里。'
                }
                className="min-h-[320px] md:min-h-[360px]"
              />
            )}
          </div>
        </AdminContentPanel>
      </AdminManagementPage>
    </AdminPageShell>
  );
}
