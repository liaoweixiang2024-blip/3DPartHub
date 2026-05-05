import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import useSWR from 'swr';
import {
  getSelectionShare,
  type SelectionShareInfo,
  type SelectionProduct,
  type SelectionComponent,
  type ColumnDef,
} from '../api/selections';
import Icon from '../components/shared/Icon';
import { PageHeader } from '../components/shared/PagePrimitives';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import SafeImage from '../components/shared/SafeImage';
import { copyText } from '../lib/clipboard';
import { downloadKitList, formatKitList, getKitListTitle } from '../lib/kitList';
import { getSiteTitle } from '../lib/publicSettings';

function sv(specs: Record<string, string>, key: string): string {
  return specs[key] || '—';
}

function isManualColumn(col?: ColumnDef) {
  return col?.inputType === 'manual';
}

function isPresetColumn(col?: ColumnDef) {
  return col?.inputType === 'preset';
}

function normalizeManualValue(col: ColumnDef | undefined, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!col?.suffix) return trimmed;
  return trimmed.toUpperCase().endsWith(col.suffix.toUpperCase()) ? trimmed : `${trimmed}${col.suffix}`;
}

function columnLabel(columns: ColumnDef[], key: string) {
  const col = columns.find((item) => item.key === key);
  return col?.label || key;
}

function replaceManualPlaceholders(
  text: string | null | undefined,
  entries: Array<readonly [string, string]>,
  columns: ColumnDef[],
) {
  if (!text) return text;
  let next = text;
  for (const [key, value] of entries) {
    const col = columns.find((item) => item.key === key);
    next = next.replaceAll(`[${key}]`, value);
    if (col?.legacyPlaceholder) next = next.replaceAll(col.legacyPlaceholder, value);
  }
  return next;
}

function applyManualSpecs(
  product: SelectionProduct,
  columns: ColumnDef[],
  specs: Record<string, string>,
): SelectionProduct {
  const userEntries = columns
    .filter((col) => (isManualColumn(col) || isPresetColumn(col)) && specs[col.key])
    .map((col) => {
      const raw = specs[col.key];
      const value = isManualColumn(col) ? normalizeManualValue(col, raw) : raw;
      return [col.key, value] as const;
    });

  if (!userEntries.length) return product;

  const nextSpecs = { ...(product.specs as Record<string, string>) };
  for (const [key, value] of userEntries) nextSpecs[key] = value;
  if (typeof nextSpecs['型号'] === 'string') {
    nextSpecs['型号'] = replaceManualPlaceholders(nextSpecs['型号'], userEntries, columns) || nextSpecs['型号'];
  }

  const modelNo = replaceManualPlaceholders(product.modelNo, userEntries, columns);
  const name = replaceManualPlaceholders(product.name, userEntries, columns) || product.name;

  let nextComponents = product.components;
  const outletComponents: SelectionComponent[] = [];
  for (const col of columns) {
    if (!isPresetColumn(col) || !col.dependsOn || !specs[col.key]) continue;
    const routeIndex = col.dependsOn.minIndex;
    outletComponents.push({
      name: `第${routeIndex}路出口接头`,
      modelNo: `PL${specs[col.key]}-02`,
      qty: 1,
    });
  }
  if (outletComponents.length > 0) {
    const existing = (nextComponents || []) as SelectionComponent[];
    nextComponents = [...existing, ...outletComponents];
    nextSpecs['BOM条数'] = String(nextComponents.length);
  }

  return { ...product, name, modelNo, specs: nextSpecs, components: nextComponents };
}

function ShareResultCard({
  product,
  columns,
  specs,
  optionOrder,
}: {
  product: SelectionProduct;
  columns: ColumnDef[];
  specs: Record<string, string>;
  optionOrder?: Record<string, unknown> | null;
}) {
  const displayProduct = applyManualSpecs(product, columns, specs);
  const specCols = columns.filter((c) => !c.hideInResults);
  const comps = (
    displayProduct.isKit && displayProduct.components ? displayProduct.components : []
  ) as SelectionComponent[];
  const kitListTitle = getKitListTitle(optionOrder || null, displayProduct);
  const [copiedList, setCopiedList] = useState(false);
  const handleCopyKitList = async () => {
    await copyText(formatKitList(displayProduct, comps, kitListTitle));
    setCopiedList(true);
    window.setTimeout(() => setCopiedList(false), 1600);
  };

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        {displayProduct.image && (
          <SafeImage
            src={displayProduct.image}
            alt=""
            className="w-16 h-16 rounded-lg object-cover shrink-0 border border-outline-variant/10"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-on-surface break-all">
              {displayProduct.modelNo || displayProduct.name}
            </span>
            {displayProduct.isKit && (
              <span className="text-[10px] font-medium text-primary-container bg-primary-container/10 px-2 py-0.5 rounded-full">
                套件
              </span>
            )}
          </div>
          {displayProduct.modelNo && displayProduct.name !== displayProduct.modelNo && (
            <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2 break-words">{displayProduct.name}</p>
          )}
        </div>
      </div>

      <div className="px-4 pb-2.5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
          {specCols.map((col) => {
            const v = sv(displayProduct.specs as Record<string, string>, col.key);
            if (v === '—') return null;
            return (
              <div key={col.key} className="text-xs min-w-0">
                <span className="text-on-surface-variant">{col.label}: </span>
                <span className="text-on-surface font-medium break-words">{v}</span>
              </div>
            );
          })}
        </div>
      </div>

      {product.isKit && comps.length > 0 && (
        <div className="border-t border-outline-variant/10 px-4 py-2.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-on-surface-variant">
              {kitListTitle}（{comps.length}）
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={handleCopyKitList}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name="content_copy" size={13} />
                <span>{copiedList ? '已复制' : '复制清单'}</span>
              </button>
              <button
                onClick={() => downloadKitList(displayProduct, comps, kitListTitle)}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name="download" size={13} />
                <span>下载清单</span>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-outline-variant/10">
            <table className="min-w-full text-xs">
              <thead className="bg-surface-container-high text-on-surface-variant">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">#</th>
                  <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">名称</th>
                  <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">型号</th>
                  <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">数量</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c, i) => (
                  <tr key={i} className="border-t border-outline-variant/10">
                    <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">{i + 1}</td>
                    <td className="px-2 py-1.5 text-on-surface whitespace-nowrap">{c.name}</td>
                    <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">{c.modelNo || '—'}</td>
                    <td className="px-2 py-1.5 text-right text-on-surface whitespace-nowrap">{c.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="border-t border-outline-variant/10 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {displayProduct.pdfUrl && (
          <a
            href={displayProduct.pdfUrl}
            target="_blank"
            rel="noopener"
            className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1"
          >
            <Icon name="library_books" size={14} />
            规格书
          </a>
        )}
        {displayProduct.matchedModelId && (
          <Link
            to={`/model/${displayProduct.matchedModelId}`}
            className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1"
          >
            <Icon name="view_in_ar" size={14} />
            查看模型
          </Link>
        )}
      </div>
    </div>
  );
}

export default function SelectionSharePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const siteTitle = getSiteTitle();

  const { data, error } = useSWR<SelectionShareInfo>(token ? `selection-share-${token}` : null, () =>
    getSelectionShare(token!),
  );

  const redirected = useRef(false);

  // Redirect selection-mode shares (no products) to the selection page
  useEffect(() => {
    if (!data || redirected.current) return;
    const isSelectionMode = data.products.length === 0;
    if (!isSelectionMode) return;

    redirected.current = true;
    const specs = data.specs as Record<string, string>;
    const hasSpecs = specs && Object.keys(specs).length > 0;
    navigate('/selection', {
      replace: true,
      state: {
        shareSlug: data.categorySlug,
        ...(hasSpecs ? { shareSpecs: specs } : {}),
      },
    });
  }, [data, navigate]);

  if (error) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 flex-col items-center justify-center bg-surface gap-4">
          <Icon name="link_off" size={48} className="text-on-surface-variant/30" />
          <p className="text-sm text-on-surface-variant">分享链接无效或已过期</p>
          <Link to="/" className="text-primary-container hover:underline mt-2 text-sm">
            返回首页
          </Link>
        </div>
      </PublicPageShell>
    );
  }

  if (!data) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 items-center justify-center bg-surface">
          <Icon name="hourglass_empty" size={32} className="text-on-surface-variant/30 animate-spin" />
        </div>
      </PublicPageShell>
    );
  }

  const specs = data.specs as Record<string, string>;

  // Still loading redirect
  if (data.products.length === 0) {
    return (
      <PublicPageShell>
        <div className="flex flex-1 items-center justify-center bg-surface">
          <Icon name="hourglass_empty" size={32} className="text-on-surface-variant/30 animate-spin" />
        </div>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell>
      {/* Top bar */}
      <div className="border-b border-outline-variant/10 bg-surface-container-low px-4 md:px-8 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="share" size={16} className="text-primary-container" />
          <span className="text-sm font-medium text-on-surface shrink-0">选型分享</span>
        </div>
        <div className="flex items-center gap-3 self-end sm:self-auto">
          <Link to="/selection" className="text-xs text-primary-container hover:underline">
            开始新的选型
          </Link>
          <Link to="/login" className="text-xs text-on-surface-variant hover:text-on-surface">
            登录
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Category & specs */}
        <div>
          <PageHeader title={data.categoryName} className="mb-2" />
          {Object.keys(specs).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(specs).map(([k, v]) => (
                <span
                  key={k}
                  className="text-xs bg-surface-container-high text-on-surface px-2.5 py-1 rounded-full break-words"
                >
                  {columnLabel(data.columns, k)}: <strong className="text-on-surface">{v}</strong>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Product count */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-on-surface-variant">
            匹配到 <strong className="text-on-surface">{data.products.length}</strong> 个型号
          </p>
        </div>

        {/* Products */}
        {data.products.length > 0 ? (
          <div className="space-y-3">
            {data.products.map((p) => (
              <ShareResultCard
                key={p.id}
                product={p}
                columns={data.columns}
                specs={specs}
                optionOrder={(data.optionOrder || null) as Record<string, unknown> | null}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-10">
            <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
            <p className="text-sm text-on-surface-variant">产品信息已更新，暂无匹配结果</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-outline-variant/10 pt-4 text-center">
          <p className="text-xs text-on-surface-variant">
            由 {siteTitle} 选型系统生成 ·{' '}
            <Link to="/selection" className="text-primary-container hover:underline">
              开始新的选型
            </Link>
          </p>
        </div>
      </div>
    </PublicPageShell>
  );
}
