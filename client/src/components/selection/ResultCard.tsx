import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, SelectionProduct, SelectionComponent } from '../../api/selections';
import { openDocumentUrl } from '../../lib/browserDownload';
import { copyText } from '../../lib/clipboard';
import { downloadKitList, formatKitList } from '../../lib/kitList';
import { isSafeUrl } from '../../lib/sanitizeHtml';
import Icon from '../shared/Icon';
import SafeImage from '../shared/SafeImage';
import { useToast } from '../shared/Toast';
import { displayProductName, selectionMotion, selectionPress } from './selectionUtils';

export function ResultCard({
  product,
  columns,
  kitListTitle,
  selected,
  onToggleSelect,
  onToggleInquiry,
  onPrepareSourceUrl,
  onBuildSourceUrl,
  expandedKits,
  onToggleKit,
  navigate,
  isMobile,
}: {
  product: SelectionProduct;
  columns: ColumnDef[];
  kitListTitle: string;
  selected: boolean;
  onToggleSelect?: () => void;
  onToggleInquiry?: () => void;
  /** 预创建选型分享快照（用户意图跳工单页时触发一次） */
  onPrepareSourceUrl?: () => void;
  /** 返回该结果所属选型状态对应的来源链接（如选型分享 /selection/s/<token>），未提供则回退模型页/选型首页 */
  onBuildSourceUrl?: () => string | null | undefined;
  expandedKits: Set<string>;
  onToggleKit: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  isMobile: boolean;
}) {
  const expanded = expandedKits.has(product.id);
  const { t } = useTranslation();
  const comps = (product.isKit && product.components ? product.components : []) as SelectionComponent[];
  // 子零件附加参数列（批量导入表头自动识别，如「编码」）：取清单中出现过的 key 并集，作为表格附加列
  const compSpecKeys = [...new Set(comps.flatMap((c) => Object.keys(c.specs || {})))];
  const specCols = columns.filter((c) => !c.hideInResults);
  // 服务端配置的 PDF/目录 URL 进 iframe src / 新窗口 document.write 前统一过协议白名单，
  // 不安全的（javascript:/data: 等）一律按不存在处理
  const catalogPdf =
    product.categoryCatalogPdf && isSafeUrl(product.categoryCatalogPdf) ? product.categoryCatalogPdf : null;
  const isCatalogImage = catalogPdf && /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(catalogPdf);
  const [showCatalog, setShowCatalog] = useState(true);
  // 画册放大弹窗（图片放大查看 / PDF 直接渲染内容）
  const [catalogZoom, setCatalogZoom] = useState(false);
  const { toast } = useToast();
  const displayName = displayProductName(product);
  const primaryTitle = product.modelNo || displayName || product.name;

  const handleCopy = async () => {
    const parts = [product.modelNo || displayName].filter(Boolean) as string[];
    if (displayName && displayName !== product.modelNo) parts.push(displayName);
    await copyText(parts.join(' '));
    toast(t('selectionResult.toasts.copiedModel'), 'success');
  };
  const handleCopyKitList = async () => {
    await copyText(formatKitList(product, comps, kitListTitle));
    toast(t('selectionResult.toasts.copiedList', { title: kitListTitle }), 'success');
  };
  const handleDownloadKitList = () => {
    downloadKitList(product, comps, kitListTitle);
    toast(t('selectionResult.toasts.downloadedList', { title: kitListTitle }), 'success');
  };

  // Esc 关闭画册放大弹窗
  useEffect(() => {
    if (!catalogZoom) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCatalogZoom(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [catalogZoom]);

  return (
    <div
      className={`rounded-xl md:rounded-2xl border overflow-hidden ${selectionMotion} ${selected ? 'border-primary-container/40 bg-primary-container/5 shadow-sm' : 'border-outline-variant/15 bg-surface-container-low hover:border-outline-variant/25'}`}
    >
      <div className="flex items-start gap-3 px-3 md:px-4 py-3 md:py-3.5">
        {product.image && (
          <SafeImage
            src={product.image}
            alt=""
            className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover shrink-0 border border-outline-variant/10"
            fallbackIcon="image"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {onToggleSelect && (
              <input
                id={`result-select-${product.id}`}
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                className="h-4 w-4 rounded accent-primary-container shrink-0"
              />
            )}
            <span className="font-mono text-sm md:text-base font-bold text-on-surface break-all">{primaryTitle}</span>
            <button
              onClick={handleCopy}
              aria-label={t('selectionResult.copyModelAria')}
              className={`text-on-surface-variant/50 hover:text-on-surface-variant ${selectionPress}`}
            >
              <Icon name="content_copy" size={14} />
            </button>
            {product.isKit && (
              <span className="text-[10px] md:text-xs font-medium text-primary-container bg-primary-container/10 px-1.5 md:px-2 py-0.5 rounded-full">
                {t('selectionResult.kit')}
              </span>
            )}
          </div>
          {displayName && displayName !== primaryTitle && (
            <p className="text-xs md:text-sm text-on-surface-variant mt-0.5 truncate">{displayName}</p>
          )}
        </div>
      </div>

      <div className="px-3 md:px-4 pb-2.5 md:pb-3">
        <div
          className={`grid gap-x-3 md:gap-x-4 gap-y-0.5 md:gap-y-1 ${isMobile ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`}
        >
          {specCols.map((col) => {
            const v = (product.specs as Record<string, string>)[col.key] || '—';
            if (v === '—') return null;
            // 值与副标题中文名相同（如「接头形态」拼进了产品名）→ 副标题已展示，参数面板不再重复
            if (v === displayName) return null;
            return (
              <div key={col.key} className="text-xs md:text-sm min-w-0">
                <span className="text-on-surface-variant">{col.label}: </span>
                <span className="text-on-surface font-medium break-words">{v}</span>
              </div>
            );
          })}
        </div>
      </div>

      {product.isKit && comps.length > 0 && (
        <div className="border-t border-outline-variant/10">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm text-on-surface-variant">
            <span>
              {kitListTitle}（{comps.length}）
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onToggleKit(product.id)}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name={expanded ? 'visibility_off' : 'visibility'} size={14} />
                <span>{expanded ? t('selectionResult.collapseList') : t('selectionResult.viewList')}</span>
              </button>
              <button
                onClick={handleCopyKitList}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name="content_copy" size={14} />
                <span>{t('selectionResult.copyList')}</span>
              </button>
              <button
                onClick={handleDownloadKitList}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name="download" size={14} />
                <span>{t('selectionResult.downloadList')}</span>
              </button>
            </div>
          </div>
          {expanded && (
            <div className="px-3 md:px-4 pb-3">
              <div className="overflow-x-auto rounded-lg border border-outline-variant/10">
                <table className="min-w-full text-xs md:text-sm">
                  <thead className="bg-surface-container-high text-on-surface-variant">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">#</th>
                      <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                        {t('selectionResult.name')}
                      </th>
                      <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                        {t('selectionResult.modelNo')}
                      </th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">
                        {t('selectionResult.qty')}
                      </th>
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
            </div>
          )}
        </div>
      )}

      {catalogPdf && (
        <div className="border-t border-outline-variant/10">
          {/* 标题行与子零件清单同构：左侧标题，右侧描边小按钮组 */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 md:px-4 py-2 md:py-2.5 text-xs md:text-sm text-on-surface-variant">
            <span className="flex items-center gap-1">
              <Icon name="menu_book" size={14} />
              {t('selectionResult.catalogMaterials')}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setShowCatalog((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name={showCatalog ? 'visibility_off' : 'visibility'} size={14} />
                <span>{showCatalog ? t('selectionResult.collapseCatalog') : t('selectionResult.viewCatalog')}</span>
              </button>
              <button
                onClick={() => setCatalogZoom(true)}
                className={`inline-flex items-center gap-1 rounded-md border border-outline-variant/20 px-2 py-1 hover:bg-surface-container-high/40 ${selectionPress}`}
              >
                <Icon name="zoom_in" size={14} />
                <span>{t('selectionResult.zoomCatalog')}</span>
              </button>
            </div>
          </div>
          {showCatalog && (
            <div className="px-3 md:px-4 pb-3">
              {isCatalogImage ? (
                <img
                  src={catalogPdf}
                  alt={t('selectionResult.catalog')}
                  onClick={() => setCatalogZoom(true)}
                  className="max-h-80 cursor-zoom-in rounded border border-outline-variant/10 object-contain transition-opacity hover:opacity-90"
                />
              ) : (
                <iframe
                  src={catalogPdf}
                  className="w-full h-80 rounded border border-outline-variant/10"
                  title={t('selectionResult.catalogPdf')}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-outline-variant/10 px-3 md:px-4 py-2 md:py-2.5 flex items-center gap-1.5 md:gap-2 flex-wrap">
        {onToggleInquiry ? (
          <button
            onClick={onToggleInquiry}
            className={`inline-flex items-center gap-1 px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium rounded-lg transition-colors ${
              selected
                ? 'border border-primary-container/35 bg-primary-container/10 text-primary-container hover:bg-primary-container/15'
                : 'border border-transparent bg-primary-container text-on-primary hover:opacity-90'
            } ${selectionPress}`}
          >
            <Icon name={selected ? 'check' : 'add'} size={14} />
            {/* 两态文案叠格（一显一隐）：按钮宽度恒取较长者，切换状态时后续按钮零位移 */}
            <span className="grid">
              <span className="col-start-1 row-start-1 invisible">{t('selectionResult.addedInquiry')}</span>
              <span className="col-start-1 row-start-1">
                {selected ? t('selectionResult.addedInquiry') : t('selectionResult.addInquiry')}
              </span>
            </span>
          </button>
        ) : onToggleSelect ? (
          /* 询价关闭：清单用于批量导出 —— 显式「添加到清单」按钮（与勾选框同状态） */
          <button
            onClick={onToggleSelect}
            className={`inline-flex items-center gap-1 px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium rounded-lg transition-colors ${
              selected
                ? 'border border-primary-container/35 bg-primary-container/10 text-primary-container hover:bg-primary-container/15'
                : 'border border-transparent bg-primary-container text-on-primary hover:opacity-90'
            } ${selectionPress}`}
          >
            <Icon name={selected ? 'check' : 'add'} size={14} />
            {/* 同上：两态文案叠格防宽度跳动 */}
            <span className="grid">
              <span className="col-start-1 row-start-1 invisible">{t('selectionResult.addToList')}</span>
              <span className="col-start-1 row-start-1">
                {selected ? t('selectionResult.addedList') : t('selectionResult.addToList')}
              </span>
            </span>
          </button>
        ) : null}
        {product.pdfUrl && isSafeUrl(product.pdfUrl) && (
          <a
            href={product.pdfUrl}
            target="_blank"
            rel="noopener"
            onClick={(event) => {
              event.preventDefault();
              openDocumentUrl(product.pdfUrl!, { title: t('selectionResult.pdfSpec') });
            }}
            className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
          >
            <Icon name="library_books" size={14} />
            <span>{t('selectionResult.specSheet')}</span>
          </a>
        )}
        {product.matchedModelId ? (
          <a
            href={`/model/${product.matchedModelId}`}
            target="_blank"
            rel="noopener"
            className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
          >
            <Icon name="view_in_ar" size={14} />
            <span>{t('selectionResult.model')}</span>
          </a>
        ) : null}
        <button
          onClick={() => {
            onPrepareSourceUrl?.();
            navigate(`/support`, {
              state: {
                modelNo: product.modelNo || product.name,
                sourceUrl:
                  onBuildSourceUrl?.() ?? (product.matchedModelId ? `/model/${product.matchedModelId}` : '/selection'),
                specs: product.specs,
                source: 'selection' as const,
              },
            });
          }}
          className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
        >
          <Icon name="support_agent" size={14} />
          <span>{t('selectionResult.support')}</span>
        </button>
      </div>

      {/* 画册放大弹窗：图片放大查看 / PDF 直接渲染内容，头部保留新窗口打开（原底部画册按钮的能力并入这里） */}
      {catalogZoom && catalogPdf && (
        <div
          className="fixed inset-0 z-[320] flex items-center justify-center bg-black/70 p-3 sm:p-6"
          onClick={() => setCatalogZoom(false)}
        >
          <div
            className="flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-on-surface">
                <Icon name="menu_book" size={16} className="shrink-0 text-primary-container" />
                <span className="truncate">
                  {primaryTitle} · {t('selectionResult.catalogMaterials')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => openDocumentUrl(catalogPdf, { title: t('selectionResult.productCatalog') })}
                  aria-label={t('selectionResult.productCatalog')}
                  className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                >
                  <Icon name="open_in_new" size={16} />
                </button>
                <button
                  onClick={() => setCatalogZoom(false)}
                  aria-label={t('common.close')}
                  className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                >
                  <Icon name="close" size={18} />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surface-container-lowest p-2 sm:p-4">
              {isCatalogImage ? (
                <img
                  src={catalogPdf}
                  alt={t('selectionResult.catalog')}
                  className="max-h-full max-w-full rounded object-contain"
                />
              ) : (
                <iframe
                  src={catalogPdf}
                  className="h-full min-h-[60dvh] w-full rounded"
                  title={t('selectionResult.catalogPdf')}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
