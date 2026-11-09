import type { TFunction } from 'i18next';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { isSafeUrl } from '../lib/sanitizeHtml';
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
import { PageRefreshIndicator } from '../components/shared/PageRefreshFallback';
import { PublicPageShell } from '../components/shared/PublicPageShell';
import SafeImage from '../components/shared/SafeImage';
import { checkProtectedAccess } from '../components/shared/ProtectedLink';
import LoginConfirmDialog from '../components/shared/LoginConfirmDialog';
import { CatalogZoomModal } from '../components/selection/CatalogZoomModal';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { openDocumentUrl } from '../lib/browserDownload';
import { copyText } from '../lib/clipboard';
import { downloadKitList, formatKitList, getKitListTitle } from '../lib/kitList';
import { getSiteTitle, useFeatureFlags } from '../lib/publicSettings';
import { useAuthStore } from '../stores/useAuthStore';

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

function SelectionShareLoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh">
      <PageRefreshIndicator label={t('selectionShare.refreshLabel')} />
    </div>
  );
}

function applyManualSpecs(
  product: SelectionProduct,
  columns: ColumnDef[],
  specs: Record<string, string>,
  t: TFunction,
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
      name: t('selectionShare.generatedOutlet', { index: routeIndex }),
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
  onSupport,
}: {
  product: SelectionProduct;
  columns: ColumnDef[];
  specs: Record<string, string>;
  optionOrder?: Record<string, unknown> | null;
  /** 咨询客服（登录直达工单页 / 匿名弹登录确认）：处理在页面层，登录弹窗需挂在壳层内容内 */
  onSupport?: (product: SelectionProduct) => void;
}) {
  const { t } = useTranslation();
  const displayProduct = applyManualSpecs(product, columns, specs, t);
  const specCols = columns.filter((c) => !c.hideInResults);
  const comps = (
    displayProduct.isKit && displayProduct.components ? displayProduct.components : []
  ) as SelectionComponent[];
  // 子零件附加参数列（批量导入表头识别，如「编码」）：与选型页清单表同列展示
  const compSpecKeys = [...new Set(comps.flatMap((c) => Object.keys(c.specs || {})))];
  const kitListTitle = getKitListTitle(optionOrder || null, displayProduct);
  // 与向导结果卡片同交互：清单/画册默认收起，点「查看」再展开
  const [showKitList, setShowKitList] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogZoom, setCatalogZoom] = useState(false);
  const [copiedList, setCopiedList] = useState(false);
  const [copiedModel, setCopiedModel] = useState(false);
  const handleCopyModel = async () => {
    const parts = [displayProduct.modelNo, displayProduct.name].filter(Boolean) as string[];
    if (displayProduct.name === displayProduct.modelNo) parts.splice(1);
    await copyText(parts.join(' '));
    setCopiedModel(true);
    window.setTimeout(() => setCopiedModel(false), 1600);
  };
  const handleCopyKitList = async () => {
    await copyText(formatKitList(displayProduct, comps, kitListTitle));
    setCopiedList(true);
    window.setTimeout(() => setCopiedList(false), 1600);
  };
  // 服务端配置的 PDF/目录 URL 进 iframe src / 新窗口前过协议白名单（与向导卡片同规则）
  const catalogPdf =
    product.categoryCatalogPdf && isSafeUrl(product.categoryCatalogPdf) ? product.categoryCatalogPdf : null;
  const isCatalogImage = catalogPdf && /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(catalogPdf);
  // 卡片图：产品自带图缺失时回落匹配模型的缩略图（与全局搜索列表同规则）
  const cardImage = displayProduct.image || displayProduct.matchedModelThumbnail || null;

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        {cardImage && (
          <SafeImage
            src={cardImage}
            alt=""
            className="w-16 h-16 rounded-lg object-cover shrink-0 border border-outline-variant/10"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-on-surface break-all">
              {displayProduct.modelNo || displayProduct.name}
            </span>
            {displayProduct.modelNo && (
              <button
                onClick={handleCopyModel}
                aria-label={copiedModel ? t('selectionResult.toasts.copiedModel') : t('selectionResult.copyModelAria')}
                className="text-on-surface-variant/50 hover:text-on-surface-variant"
              >
                <Icon name={copiedModel ? 'check' : 'content_copy'} size={13} />
              </button>
            )}
            {displayProduct.isKit && (
              <span className="text-[10px] font-medium text-primary-container bg-primary-container/10 px-2 py-0.5 rounded-full">
                {t('selectionShare.kit')}
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
          <div className={`${showKitList ? 'mb-2' : ''} flex flex-wrap items-center justify-between gap-2`}>
            <p className="flex items-center gap-1 text-xs text-on-surface-variant">
              <Icon name="inventory_2" size={13} />
              {kitListTitle}（{comps.length}）
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setShowKitList((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name={showKitList ? 'visibility_off' : 'visibility'} size={13} />
                <span>{showKitList ? t('selectionResult.collapseList') : t('selectionResult.viewList')}</span>
              </button>
              <button
                onClick={handleCopyKitList}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name="content_copy" size={13} />
                <span>{copiedList ? t('selectionShare.copied') : t('selectionShare.copyList')}</span>
              </button>
              <button
                onClick={() => void downloadKitList(displayProduct, comps, kitListTitle).catch(() => undefined)}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name="download" size={13} />
                <span>{t('selectionShare.downloadList')}</span>
              </button>
            </div>
          </div>
          {showKitList && (
            <div className="overflow-x-auto rounded-lg border border-outline-variant/10">
              <table className="min-w-full text-xs">
                <thead className="bg-surface-container-high text-on-surface-variant">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">#</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{t('selectionShare.name')}</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                      {t('selectionShare.modelNo')}
                    </th>
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{t('selectionShare.qty')}</th>
                    {compSpecKeys.map((key) => (
                      <th key={key} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comps.map((c, i) => (
                    <tr key={i} className="border-t border-outline-variant/10">
                      <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">{i + 1}</td>
                      <td className="px-2 py-1.5 text-on-surface whitespace-nowrap">{c.name}</td>
                      <td className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">{c.modelNo || '—'}</td>
                      <td className="px-2 py-1.5 text-right text-on-surface whitespace-nowrap">{c.qty}</td>
                      {compSpecKeys.map((key) => (
                        <td key={key} className="px-2 py-1.5 text-on-surface-variant whitespace-nowrap">
                          {c.specs?.[key] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {catalogPdf && (
        <div className="border-t border-outline-variant/10 px-4 py-2.5">
          <div className={`${showCatalog ? 'mb-2' : ''} flex flex-wrap items-center justify-between gap-2`}>
            <p className="flex items-center gap-1 text-xs text-on-surface-variant">
              <Icon name="menu_book" size={13} />
              {t('selectionResult.catalogMaterials')}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setShowCatalog((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name={showCatalog ? 'visibility_off' : 'visibility'} size={13} />
                <span>{showCatalog ? t('selectionResult.collapseCatalog') : t('selectionResult.viewCatalog')}</span>
              </button>
              <button
                onClick={() => setCatalogZoom(true)}
                className="inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-high/40"
              >
                <Icon name="zoom_in" size={13} />
                <span>{t('selectionResult.zoomCatalog')}</span>
              </button>
            </div>
          </div>
          {showCatalog &&
            (isCatalogImage ? (
              <img
                src={catalogPdf}
                alt={t('selectionResult.catalog')}
                onClick={() => setCatalogZoom(true)}
                className="max-h-80 cursor-zoom-in rounded border border-outline-variant/10 object-contain transition-opacity hover:opacity-90"
              />
            ) : (
              <iframe
                src={catalogPdf}
                className="h-80 w-full rounded border border-outline-variant/10"
                title={t('selectionResult.catalogPdf')}
              />
            ))}
        </div>
      )}

      <div className="border-t border-outline-variant/10 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {displayProduct.pdfUrl && isSafeUrl(displayProduct.pdfUrl) && (
          <a
            href={displayProduct.pdfUrl}
            target="_blank"
            rel="noopener"
            onClick={(event) => {
              event.preventDefault();
              openDocumentUrl(displayProduct.pdfUrl!, { title: t('selectionShare.pdfTitle') });
            }}
            className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1"
          >
            <Icon name="library_books" size={14} />
            {t('selectionShare.specSheet')}
          </a>
        )}
        {displayProduct.matchedModelId && (
          <Link
            to={`/model/${displayProduct.matchedModelId}`}
            className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1"
          >
            <Icon name="view_in_ar" size={14} />
            {t('selectionShare.viewModel')}
          </Link>
        )}
        {onSupport && (
          <button
            onClick={() => onSupport(displayProduct)}
            className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1"
          >
            <Icon name="support_agent" size={14} />
            {t('selectionResult.support')}
          </button>
        )}
      </div>

      {/* 画册放大弹窗（portal 到 body）：图片缩放平移 / PDF 内嵌渲染，与向导卡片同款 */}
      {catalogZoom && catalogPdf && (
        <CatalogZoomModal
          productTitle={displayProduct.modelNo || displayProduct.name}
          src={catalogPdf}
          isImage={!!isCatalogImage}
          onClose={() => setCatalogZoom(false)}
        />
      )}
    </div>
  );
}

export default function SelectionSharePage() {
  const { t } = useTranslation();
  useDocumentTitle(t('selectionShare.title'));
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const siteTitle = getSiteTitle();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const featureFlags = useFeatureFlags();
  // 匿名访客点「咨询客服」：登录确认弹窗（登录后回到本分享页再点一次即带预填直达工单页）
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [loginPromptReason, setLoginPromptReason] = useState('');

  const handleSupport = (product: SelectionProduct) => {
    const result = checkProtectedAccess('/support');
    if (result.action === 'allow') {
      navigate('/support', {
        state: {
          modelNo: product.modelNo || product.name,
          sourceUrl: location.pathname,
          specs: product.specs as Record<string, string>,
          source: 'selection' as const,
        },
      });
      return;
    }
    setLoginPromptReason(result.action === 'dialog' ? result.reason : t('protected.reasons.support'));
    setLoginPromptOpen(true);
  };

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
          <p className="text-sm text-on-surface-variant">{t('selectionShare.invalid')}</p>
          <Link to="/" className="text-primary-container hover:underline mt-2 text-sm">
            {t('selectionShare.backHome')}
          </Link>
        </div>
      </PublicPageShell>
    );
  }

  if (!data) {
    return (
      <PublicPageShell>
        <SelectionShareLoadingState />
      </PublicPageShell>
    );
  }

  const specs = data.specs as Record<string, string>;

  // Still loading redirect
  if (data.products.length === 0) {
    return (
      <PublicPageShell>
        <SelectionShareLoadingState />
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell>
      {/* Top bar */}
      <div className="border-b border-outline-variant/10 bg-surface-container-low px-4 md:px-8 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Icon name="share" size={16} className="text-primary-container" />
          <span className="text-sm font-medium text-on-surface shrink-0">{t('selectionShare.title')}</span>
        </div>
        <div className="flex items-center gap-3 self-end sm:self-auto">
          <Link to="/selection" className="text-xs text-primary-container hover:underline">
            {t('selectionShare.startNew')}
          </Link>
          {/* 已登录不再显示登录入口（此前写死，登录后仍然显示） */}
          {!isAuthenticated && (
            <Link to="/login" className="text-xs text-on-surface-variant hover:text-on-surface">
              {t('selectionShare.login')}
            </Link>
          )}
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
            {t('selectionShare.matchedCount', { count: data.products.length })}
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
                onSupport={featureFlags.tickets ? handleSupport : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-10">
            <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
            <p className="text-sm text-on-surface-variant">{t('selectionShare.noMatch')}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-outline-variant/10 pt-4 text-center">
          <p className="text-xs text-on-surface-variant">
            {t('selectionShare.footerGenerated', { siteTitle })} ·{' '}
            <Link to="/selection" className="text-primary-container hover:underline">
              {t('selectionShare.startNew')}
            </Link>
          </p>
        </div>

        <LoginConfirmDialog
          open={loginPromptOpen}
          onClose={() => setLoginPromptOpen(false)}
          reason={loginPromptReason || t('protected.reasons.support')}
          returnUrl={location.pathname}
        />
      </div>
    </PublicPageShell>
  );
}
