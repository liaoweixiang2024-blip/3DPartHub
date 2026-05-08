import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { downloadsApi, type DownloadAdminStats } from '../api/downloads';
import {
  AdminContentPanel,
  AdminEmptyState,
  AdminErrorState,
  AdminLoadingState,
  AdminManagementPage,
} from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import Icon from '../components/shared/Icon';
import ModelThumbnail from '../components/shared/ModelThumbnail';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useMediaQuery } from '../layouts/hooks/useMediaQuery';
import { getErrorMessage } from '../lib/errorNotifications';

type DownloadStatsTab = 'trend' | 'formats' | 'models' | 'recent';
type SearchInputProps = ReturnType<typeof useImeSafeSearchInput>['inputProps'];

const numberFormatter = new Intl.NumberFormat('zh-CN');

const TAB_META: Record<DownloadStatsTab, { label: string; icon: string; title: string; description: string }> = {
  trend: {
    label: '下载趋势',
    icon: 'data_usage',
    title: '近 14 天下载趋势',
    description: '按登录用户下载记录统计，展示每日下载量和文件体积。',
  },
  formats: {
    label: '格式分布',
    icon: 'inventory_2',
    title: '下载格式分布',
    description: '按文件格式汇总下载次数、占比和累计体积。',
  },
  models: {
    label: '热门模型',
    icon: 'download',
    title: '热门下载模型',
    description: '按模型累计下载量排序，便于发现高频需求。',
  },
  recent: {
    label: '下载记录',
    icon: 'schedule',
    title: '最近下载记录',
    description: '展示最近产生的用户下载历史和文件信息。',
  },
};

function formatNumber(value: number | null | undefined) {
  return numberFormatter.format(value || 0);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${Math.round(value)}%`;
}

function formatBytes(value: number | null | undefined) {
  const bytes = value || 0;
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
      placeholder="搜索模型、用户、格式..."
      className="md:w-72 md:shrink-0"
    />
  );
}

function DownloadStatsTabs({
  active,
  counts,
  onChange,
}: {
  active: DownloadStatsTab;
  counts: Record<DownloadStatsTab, number>;
  onChange: (value: DownloadStatsTab) => void;
}) {
  return (
    <ResponsiveSectionTabs
      tabs={(Object.keys(TAB_META) as DownloadStatsTab[]).map((value) => ({
        value,
        label: TAB_META[value].label,
        icon: TAB_META[value].icon,
        count: counts[value] || 0,
      }))}
      value={active}
      onChange={(value) => onChange(value as DownloadStatsTab)}
      mobileTitle="统计维度"
    />
  );
}

function DownloadAdminToolbar({
  active,
  counts,
  onTabChange,
  searchInputProps,
  searchInputValue,
  onClearSearch,
}: {
  active: DownloadStatsTab;
  counts: Record<DownloadStatsTab, number>;
  onTabChange: (value: DownloadStatsTab) => void;
  searchInputProps: SearchInputProps;
  searchInputValue: string;
  onClearSearch: () => void;
}) {
  return (
    <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 flex-1">
        <DownloadStatsTabs active={active} counts={counts} onChange={onTabChange} />
      </div>
      <AdminSearchField inputProps={searchInputProps} value={searchInputValue} onClear={onClearSearch} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon,
  accentClassName,
}: {
  label: string;
  value: string;
  hint: string;
  icon: string;
  accentClassName: string;
}) {
  return (
    <div className="flex min-h-24 min-w-0 items-center gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${accentClassName}`}>
        <Icon name={icon} size={19} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-on-surface-variant">{label}</p>
        <p className="mt-1 truncate text-xl font-semibold tabular-nums text-on-surface">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-on-surface-variant/70">{hint}</p>
      </div>
    </div>
  );
}

function SummaryCards({ stats }: { stats: DownloadAdminStats }) {
  const summary = stats.summary;
  const downloadedBytes =
    summary.downloadedBytes ?? stats.formatStats.reduce((total, item) => total + (item.bytes || 0), 0);
  const cards = [
    {
      label: '累计下载',
      value: formatNumber(summary.totalModelDownloads),
      hint: '模型累计计数',
      icon: 'download',
      accentClassName: 'bg-primary-container/10 text-primary-container',
    },
    {
      label: '下载记录',
      value: formatNumber(summary.historyRecords),
      hint: '登录用户历史',
      icon: 'schedule',
      accentClassName: 'bg-blue-500/10 text-blue-500',
    },
    {
      label: '今日下载',
      value: formatNumber(summary.todayDownloads),
      hint: '今天新增记录',
      icon: 'calendar_today',
      accentClassName: 'bg-emerald-500/10 text-emerald-500',
    },
    {
      label: '近 7 天',
      value: formatNumber(summary.weekDownloads),
      hint: '一周下载热度',
      icon: 'data_usage',
      accentClassName: 'bg-amber-500/10 text-amber-500',
    },
    {
      label: '活跃用户',
      value: formatNumber(summary.activeDownloaders),
      hint: '近 7 天去重',
      icon: 'group',
      accentClassName: 'bg-cyan-500/10 text-cyan-500',
    },
    {
      label: '文件体积',
      value: formatBytes(downloadedBytes),
      hint: '历史记录合计',
      icon: 'storage',
      accentClassName: 'bg-purple-500/10 text-purple-500',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map((item) => (
        <MetricCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function DownloadTabPanel({ tab, badge, children }: { tab: DownloadStatsTab; badge: string; children: ReactNode }) {
  const meta = TAB_META[tab];
  return (
    <section className="overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low">
      <div className="flex items-start justify-between gap-4 border-b border-outline-variant/10 px-4 py-4 md:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-container-high text-primary-container">
            <Icon name={meta.icon} size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-on-surface">{meta.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{meta.description}</p>
          </div>
        </div>
        <span className="hidden shrink-0 rounded-full bg-surface-container-high px-3 py-1 text-xs font-medium text-on-surface-variant md:inline-flex">
          {badge}
        </span>
      </div>
      <div className="p-3 md:p-4">{children}</div>
    </section>
  );
}

function TrendPanel({ data }: { data: DownloadAdminStats['dailyStats'] }) {
  const totalDownloads = data.reduce((total, item) => total + item.downloads, 0);
  const totalBytes = data.reduce((total, item) => total + item.bytes, 0);
  const maxDownloads = Math.max(1, ...data.map((item) => item.downloads));
  const peak = data.reduce(
    (best, item) => (item.downloads > best.downloads ? item : best),
    data[0] || {
      date: '',
      downloads: 0,
      bytes: 0,
    },
  );

  return (
    <DownloadTabPanel tab="trend" badge={`共 ${formatNumber(totalDownloads)} 次`}>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricMini label="区间下载" value={`${formatNumber(totalDownloads)} 次`} icon="download" />
        <MetricMini
          label="峰值日期"
          value={peak.date ? `${formatDate(peak.date)} · ${peak.downloads} 次` : '暂无'}
          icon="bolt"
        />
        <MetricMini label="区间体积" value={formatBytes(totalBytes)} icon="storage" />
      </div>
      <div className="mt-4 flex h-72 items-end gap-1.5 rounded-xl border border-outline-variant/8 bg-surface px-3 pb-3 pt-5 sm:gap-2">
        {data.map((item) => {
          const height = Math.max(6, Math.round((item.downloads / maxDownloads) * 100));
          return (
            <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-full w-full items-end rounded-lg bg-surface-container-high/55 px-1 pt-3">
                <div
                  className="w-full rounded-t bg-primary-container/85 transition-all group-hover:bg-primary-container"
                  style={{ height: `${height}%` }}
                  title={`${item.date}: ${item.downloads} 次 · ${formatBytes(item.bytes)}`}
                />
              </div>
              <span className="hidden text-[10px] tabular-nums text-on-surface-variant sm:block">
                {item.date.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </DownloadTabPanel>
  );
}

function MetricMini({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-outline-variant/8 bg-surface px-3 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary-container/10 text-primary-container">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] text-on-surface-variant">{label}</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-on-surface">{value}</p>
      </div>
    </div>
  );
}

function FormatPanel({ items }: { items: DownloadAdminStats['formatStats'] }) {
  const totalDownloads = items.reduce((total, item) => total + item.downloads, 0);
  const maxDownloads = Math.max(1, ...items.map((item) => item.downloads));

  return (
    <DownloadTabPanel tab="formats" badge={`${formatNumber(items.length)} 种格式`}>
      {items.length === 0 ? (
        <AdminEmptyState
          icon="inventory_2"
          title="暂无格式统计"
          description="有用户下载模型后，这里会显示格式分布。"
          className="min-h-[280px] py-12"
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((item) => {
            const percent = (item.downloads / Math.max(1, totalDownloads)) * 100;
            const width = Math.max(4, (item.downloads / maxDownloads) * 100);
            return (
              <div key={item.format} className="rounded-xl border border-outline-variant/8 bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{item.format.toUpperCase()}</p>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {formatNumber(item.downloads)} 次 · {formatBytes(item.bytes)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary-container/10 px-2.5 py-1 text-xs font-semibold text-primary-container">
                    {formatPercent(percent)}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high">
                  <div className="h-full rounded-full bg-primary-container" style={{ width: `${width}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DownloadTabPanel>
  );
}

function TopModelsPanel({ models }: { models: DownloadAdminStats['topModels'] }) {
  const maxDownloads = Math.max(1, ...models.map((model) => model.download_count));

  return (
    <DownloadTabPanel tab="models" badge={`${formatNumber(models.length)} 个模型`}>
      {models.length === 0 ? (
        <AdminEmptyState
          icon="download"
          title="暂无热门模型"
          description="换个关键词试试，或等待用户下载模型。"
          className="min-h-[280px] py-12"
        />
      ) : (
        <div className="space-y-2">
          {models.map((model, index) => {
            const width = Math.max(4, (model.download_count / maxDownloads) * 100);
            return (
              <Link
                key={model.model_id}
                to={`/model/${model.model_id}`}
                className="group flex items-center gap-3 rounded-xl border border-outline-variant/8 bg-surface px-3 py-3 transition-colors hover:bg-surface-container-high/55"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-container-high text-xs font-bold tabular-nums text-on-surface-variant group-hover:text-on-surface">
                  {index + 1}
                </span>
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-container-high">
                  <ModelThumbnail src={model.thumbnail_url} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-on-surface group-hover:text-primary-container">
                      {model.name}
                    </p>
                    <span className="hidden shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-medium text-on-surface-variant sm:inline-flex">
                      {model.format?.toUpperCase() || 'MODEL'}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-on-surface-variant">{model.category || '未分类'}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="h-full rounded-full bg-primary-container" style={{ width: `${width}%` }} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-semibold tabular-nums text-on-surface">
                    {formatNumber(model.download_count)}
                  </p>
                  <p className="text-[10px] text-on-surface-variant">下载</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </DownloadTabPanel>
  );
}

function RecentDownloadsPanel({ items }: { items: DownloadAdminStats['recentDownloads'] }) {
  return (
    <DownloadTabPanel tab="recent" badge={`${formatNumber(items.length)} 条记录`}>
      {items.length === 0 ? (
        <AdminEmptyState
          icon="schedule"
          title="暂无下载记录"
          description="换个关键词试试，或等待用户下载模型。"
          className="min-h-[280px] py-12"
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={item.id}
              to={`/model/${item.model_id}`}
              className="group flex items-center gap-3 rounded-xl border border-outline-variant/8 bg-surface px-3 py-3 transition-colors hover:bg-surface-container-high/55"
            >
              <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-container-high">
                <ModelThumbnail src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-on-surface group-hover:text-primary-container">
                  {item.model_name}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Icon name="person" size={12} />
                    <span className="truncate">{item.username}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Icon name="inventory_2" size={12} />
                    {(item.format || item.model_format || 'model').toUpperCase()}
                  </span>
                  <span>{formatBytes(item.file_size)}</span>
                </div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-on-surface-variant">
                {formatDateTime(item.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </DownloadTabPanel>
  );
}

function getTabCounts(data?: DownloadAdminStats): Record<DownloadStatsTab, number> {
  return {
    trend: data?.dailyStats.reduce((total, item) => total + item.downloads, 0) ?? 0,
    formats: data?.formatStats.length ?? 0,
    models: data?.topModels.length ?? 0,
    recent: data?.recentDownloads.length ?? 0,
  };
}

function LoadingState({ actions, toolbar }: { actions: ReactNode; toolbar: ReactNode }) {
  return (
    <AdminManagementPage
      title="下载统计"
      description="统计模型下载量、用户下载历史、热门模型和格式分布"
      actions={actions}
      toolbar={toolbar}
      contentClassName="min-h-0"
    >
      <AdminContentPanel scroll className="p-4">
        <AdminLoadingState variant="dashboard" label="下载统计加载中" />
      </AdminContentPanel>
    </AdminManagementPage>
  );
}

function Content() {
  const { toast } = useToast();
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [activeTab, setActiveTab] = useState<DownloadStatsTab>('trend');
  const [refreshing, setRefreshing] = useState(false);
  const {
    value: search,
    draftValue: searchInputValue,
    setValue: setSearch,
    inputProps: searchInputProps,
  } = useImeSafeSearchInput();
  const statsKey = `/admin/downloads/stats?search=${encodeURIComponent(search)}`;
  const { data, error, isLoading, mutate } = useSWR(statsKey, () => downloadsApi.adminStats(search));

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await mutate(undefined, { revalidate: true });
      toast('下载统计已刷新', 'success');
    } catch (err: unknown) {
      toast(getErrorMessage(err, '刷新下载统计失败'), 'error');
    } finally {
      setRefreshing(false);
    }
  }

  const actions = (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={refreshing}
      className={
        isDesktop
          ? 'flex items-center gap-2 rounded-lg border border-outline-variant/20 px-4 py-2.5 text-sm text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50'
          : 'inline-flex h-9 items-center gap-1 rounded-lg border border-outline-variant/20 px-3 text-xs text-on-surface-variant disabled:opacity-50'
      }
      aria-label="刷新"
    >
      <Icon name="refresh" size={isDesktop ? 16 : 14} className={refreshing ? 'animate-spin' : ''} />
      {isDesktop ? (refreshing ? '刷新中...' : '刷新') : null}
    </button>
  );
  const toolbar = (
    <DownloadAdminToolbar
      active={activeTab}
      counts={getTabCounts(data)}
      onTabChange={setActiveTab}
      searchInputProps={searchInputProps}
      searchInputValue={searchInputValue}
      onClearSearch={() => setSearch('')}
    />
  );

  if (isLoading) return <LoadingState actions={actions} toolbar={toolbar} />;

  if (error || !data) {
    return (
      <AdminManagementPage
        title="下载统计"
        description="统计模型下载量、用户下载历史、热门模型和格式分布"
        actions={actions}
        toolbar={toolbar}
        contentClassName="min-h-0"
      >
        <AdminContentPanel scroll>
          <AdminErrorState
            title="下载统计加载失败"
            description="请检查服务状态，或稍后重新加载。"
            onRetry={handleRefresh}
          />
        </AdminContentPanel>
      </AdminManagementPage>
    );
  }

  return (
    <AdminManagementPage
      title="下载统计"
      description="统计模型下载量、用户下载历史、热门模型和格式分布"
      actions={actions}
      toolbar={toolbar}
      contentClassName="min-h-0"
    >
      <AdminContentPanel scroll className="!border-0 !bg-transparent">
        <div className="h-full overflow-y-auto overflow-x-hidden pb-4 custom-scrollbar">
          <div className="space-y-4">
            <SummaryCards stats={data} />
            <div key={`${activeTab}:${search}`} className="admin-tab-panel">
              {activeTab === 'trend' ? <TrendPanel data={data.dailyStats} /> : null}
              {activeTab === 'formats' ? <FormatPanel items={data.formatStats} /> : null}
              {activeTab === 'models' ? <TopModelsPanel models={data.topModels} /> : null}
              {activeTab === 'recent' ? <RecentDownloadsPanel items={data.recentDownloads} /> : null}
            </div>
          </div>
        </div>
      </AdminContentPanel>
    </AdminManagementPage>
  );
}

export default function DownloadAdminPage() {
  useDocumentTitle('下载统计');
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
