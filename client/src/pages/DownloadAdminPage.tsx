import useSWR from "swr";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { downloadsApi, type DownloadAdminStats } from "../api/downloads";
import Icon from "../components/shared/Icon";
import ModelThumbnail from "../components/shared/ModelThumbnail";
import { AdminPageShell } from "../components/shared/AdminPageShell";
import { AdminContentPanel, AdminEmptyState, AdminManagementPage } from "../components/shared/AdminManagementPage";

const numberFormatter = new Intl.NumberFormat("zh-CN");

function formatNumber(value: number | null | undefined) {
  return numberFormatter.format(value || 0);
}

function formatBytes(value: number | null | undefined) {
  const bytes = value || 0;
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatsPanel({
  title,
  description,
  icon,
  iconClassName,
  children,
}: {
  title: string;
  description: string;
  icon: string;
  iconClassName: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-low">
      <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-on-surface">{title}</h2>
          <p className="mt-1 truncate text-xs text-on-surface-variant">{description}</p>
        </div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${iconClassName}`}>
          <Icon name={icon} size={18} />
        </span>
      </div>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}

function ChartPanel({ data }: { data: DownloadAdminStats["dailyStats"] }) {
  const max = Math.max(1, ...data.map((item) => item.downloads));
  return (
    <StatsPanel
      title="近 14 天下载趋势"
      description="按用户下载记录统计"
      icon="data_usage"
      iconClassName="bg-primary-container/10 text-primary-container"
    >
      <div className="flex h-full min-h-[220px] items-end gap-1.5 sm:gap-2">
        {data.map((item) => {
          const height = Math.max(8, Math.round((item.downloads / max) * 100));
          return (
            <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-full min-h-40 w-full items-end rounded-lg bg-surface-container-high/45 px-1.5 pt-3">
                <div
                  className="w-full rounded-t bg-primary-container/80 transition-all"
                  style={{ height: `${height}%` }}
                  title={`${item.date}: ${item.downloads} 次`}
                />
              </div>
              <span className="hidden text-[10px] text-on-surface-variant sm:block">{item.date.slice(5)}</span>
            </div>
          );
        })}
      </div>
    </StatsPanel>
  );
}

function TopModels({ models }: { models: DownloadAdminStats["topModels"] }) {
  return (
    <StatsPanel
      title="热门下载模型"
      description="按模型累计下载量排序"
      icon="download"
      iconClassName="bg-amber-500/10 text-amber-500"
    >
      <div className="space-y-2">
        {models.length === 0 ? (
          <AdminEmptyState icon="download" title="暂无下载数据" description="有用户下载模型后，这里会显示热门模型排行。" className="min-h-[220px] py-10" />
        ) : models.map((model, index) => (
          <Link
            key={model.model_id}
            to={`/model/${model.model_id}`}
            className="flex items-center gap-3 rounded-md border border-outline-variant/10 bg-surface-container-lowest p-2 transition-colors hover:border-primary-container/30 hover:bg-surface-container"
          >
            <span className="w-6 shrink-0 text-center text-xs font-semibold text-on-surface-variant">
              {index + 1}
            </span>
            <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-surface-container-high">
              <ModelThumbnail src={model.thumbnail_url} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-on-surface">{model.name}</p>
              <p className="mt-1 truncate text-xs text-on-surface-variant">
                {model.category || "未分类"} · {model.format?.toUpperCase() || "MODEL"}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-on-surface">{formatNumber(model.download_count)}</p>
              <p className="text-[10px] text-on-surface-variant">次</p>
            </div>
          </Link>
        ))}
      </div>
    </StatsPanel>
  );
}

function RecentDownloads({ items }: { items: DownloadAdminStats["recentDownloads"] }) {
  return (
    <StatsPanel
      title="最近下载记录"
      description="仅包含登录用户产生的下载历史"
      icon="schedule"
      iconClassName="bg-blue-500/10 text-blue-500"
    >
      <div className="space-y-2">
        {items.length === 0 ? (
          <AdminEmptyState icon="schedule" title="暂无下载记录" description="仅展示登录用户产生的下载历史。" className="min-h-[220px] py-10" />
        ) : items.map((item) => (
          <Link
            key={item.id}
            to={`/model/${item.model_id}`}
            className="flex items-center gap-3 rounded-md bg-surface-container-lowest p-2 transition-colors hover:bg-surface-container"
          >
            <div className="h-10 w-12 shrink-0 overflow-hidden rounded bg-surface-container-high">
              <ModelThumbnail src={item.thumbnail_url} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-on-surface">{item.model_name}</p>
              <p className="mt-1 truncate text-xs text-on-surface-variant">
                {item.username} · {item.format?.toUpperCase() || item.model_format?.toUpperCase()} · {formatBytes(item.file_size)}
              </p>
            </div>
            <span className="shrink-0 text-xs text-on-surface-variant">{formatDateTime(item.created_at)}</span>
          </Link>
        ))}
      </div>
    </StatsPanel>
  );
}

function FormatStats({ items }: { items: DownloadAdminStats["formatStats"] }) {
  const max = Math.max(1, ...items.map((item) => item.downloads));
  return (
    <StatsPanel
      title="格式分布"
      description="按用户下载记录统计"
      icon="inventory_2"
      iconClassName="bg-emerald-500/10 text-emerald-500"
    >
      <div className="space-y-3">
        {items.length === 0 ? (
          <AdminEmptyState icon="inventory_2" title="暂无格式统计" description="按下载格式汇总的数量和文件体积会显示在这里。" className="min-h-[220px] py-10" />
        ) : items.map((item) => (
          <div key={item.format}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-on-surface">{item.format.toUpperCase()}</span>
              <span className="text-on-surface-variant">{formatNumber(item.downloads)} 次 · {formatBytes(item.bytes)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
              <div className="h-full rounded-full bg-primary-container" style={{ width: `${Math.max(4, (item.downloads / max) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </StatsPanel>
  );
}

function LoadingState() {
  return (
    <AdminManagementPage
      title="下载统计"
      description="统计模型下载量、用户下载历史、热门模型和格式分布"
      toolbar={<div className="h-9 animate-pulse rounded-lg bg-surface-container" />}
      contentClassName="min-h-0"
    >
      <AdminContentPanel scroll className="p-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="h-80 animate-pulse rounded-xl bg-surface-container" />
          <div className="h-80 animate-pulse rounded-xl bg-surface-container" />
          <div className="h-80 animate-pulse rounded-xl bg-surface-container" />
          <div className="h-80 animate-pulse rounded-xl bg-surface-container" />
        </div>
      </AdminContentPanel>
    </AdminManagementPage>
  );
}

function Content() {
  const { data, error, isLoading, mutate } = useSWR("/admin/downloads/stats", downloadsApi.adminStats);

  if (isLoading) return <LoadingState />;

  if (error || !data) {
    return (
      <AdminManagementPage
        title="下载统计"
        description="统计模型下载量、用户下载历史、热门模型和格式分布"
        toolbar={(
          <div className="flex min-h-9 items-center justify-end">
            <button onClick={() => mutate()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-3 text-xs font-bold text-on-primary transition-opacity hover:opacity-90">
              <Icon name="refresh" size={14} /> 重新加载
            </button>
          </div>
        )}
        contentClassName="min-h-0"
      >
        <AdminContentPanel scroll>
          <AdminEmptyState icon="error" title="下载统计加载失败" description="请检查服务状态，或稍后重新加载。"
            action={<button onClick={() => mutate()} className="rounded-sm bg-primary-container px-4 py-2 text-sm font-bold text-on-primary transition-opacity hover:opacity-90">重新加载</button>}
          />
        </AdminContentPanel>
      </AdminManagementPage>
    );
  }

  const stats = data.summary;
  const metricItems = [
    { label: "累计下载", value: formatNumber(stats.totalModelDownloads), icon: "download", accent: "text-primary-container" },
    { label: "下载记录", value: formatNumber(stats.historyRecords), icon: "schedule", accent: "text-blue-500" },
    { label: "今日", value: formatNumber(stats.todayDownloads), icon: "calendar_today", accent: "text-emerald-500" },
    { label: "近 7 天", value: formatNumber(stats.weekDownloads), icon: "data_usage", accent: "text-amber-500" },
    { label: "活跃用户", value: formatNumber(stats.activeDownloaders), icon: "group", accent: "text-cyan-500" },
  ];
  const actions = (
    <button
      onClick={() => mutate()}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-sm bg-primary-container px-3 text-xs font-bold text-on-primary transition-opacity hover:opacity-90"
    >
      <Icon name="refresh" size={14} />
      刷新
    </button>
  );
  const toolbar = (
    <div className="flex min-h-12 items-center">
      <div className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        {metricItems.map((item, index) => (
          <div
            key={item.label}
            className="flex min-h-12 flex-col items-center justify-center gap-1 border-b border-r border-outline-variant/12 px-3 py-2 text-center even:border-r-0 sm:even:border-r sm:[&:nth-child(3n)]:border-r-0 xl:border-b-0 xl:even:border-r xl:[&:nth-child(3n)]:border-r xl:[&:nth-child(5n)]:border-r-0"
          >
            <span className="flex min-w-0 items-center justify-center gap-1.5">
              <Icon name={item.icon} size={14} className={item.accent} />
              <span className="truncate text-[10px] text-on-surface-variant">{item.label}</span>
            </span>
            <span className="min-w-0 max-w-full">
              <strong className={`block truncate tabular-nums leading-tight text-on-surface ${index === 0 ? "text-lg" : "text-base"}`}>{item.value}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <AdminManagementPage
      title="下载统计"
      description="统计模型下载量、用户下载历史、热门模型和格式分布"
      actions={actions}
      toolbar={toolbar}
      contentClassName="min-h-0"
    >
      <AdminContentPanel scroll>
        <div className="h-full overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel data={data.dailyStats} />
            <FormatStats items={data.formatStats} />
            <TopModels models={data.topModels} />
            <RecentDownloads items={data.recentDownloads} />
          </div>
        </div>
      </AdminContentPanel>
    </AdminManagementPage>
  );
}

export default function DownloadAdminPage() {
  useDocumentTitle("下载统计");
  return (
    <AdminPageShell desktopContentClassName="min-h-0 overflow-hidden" mobileMainClassName="min-h-0 overflow-hidden" mobileContentClassName="flex h-full min-h-0 flex-col px-4 py-4 pb-20">
      <Content />
    </AdminPageShell>
  );
}
