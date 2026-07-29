import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, SelectionProduct, SelectionComponent } from '../../api/selections';
import { openDocumentUrl } from '../../lib/browserDownload';
import { copyText } from '../../lib/clipboard';
import { downloadKitList, formatKitList } from '../../lib/kitList';
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
  expandedKits,
  onToggleKit,
  navigate,
  isMobile,
}: {
  product: SelectionProduct;
  columns: ColumnDef[];
  kitListTitle: string;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleInquiry?: () => void;
  expandedKits: Set<string>;
  onToggleKit: (id: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  isMobile: boolean;
}) {
  const expanded = expandedKits.has(product.id);
  const { t } = useTranslation();
  const comps = (product.isKit && product.components ? product.components : []) as SelectionComponent[];
  const specCols = columns.filter((c) => !c.hideInResults);
  const catalogPdf = product.categoryCatalogPdf;
  const isCatalogImage = catalogPdf && /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(catalogPdf);
  const [showCatalog, setShowCatalog] = useState(true);
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
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="h-4 w-4 rounded accent-primary-container shrink-0"
            />
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
        </div>
      )}

      {catalogPdf && (
        <div className="border-t border-outline-variant/10">
          <button
            onClick={() => setShowCatalog((v) => !v)}
            className={`w-full px-3 md:px-4 py-1.5 flex items-center justify-between text-xs text-on-surface-variant hover:bg-surface-container-high/30 ${selectionPress}`}
          >
            <span className="flex items-center gap-1">
              <Icon name="menu_book" size={14} />
              {t('selectionResult.catalogMaterials')}
            </span>
            <Icon name={showCatalog ? 'expand_less' : 'expand_more'} size={16} />
          </button>
          {showCatalog && (
            <div className="px-3 md:px-4 pb-3">
              {isCatalogImage ? (
                <img
                  src={catalogPdf}
                  alt={t('selectionResult.catalog')}
                  className="max-h-80 rounded border border-outline-variant/10 object-contain"
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
        {onToggleInquiry && (
          <button
            onClick={onToggleInquiry}
            className={`inline-flex items-center gap-1 px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-bold rounded-lg transition-colors ${
              selected
                ? 'border border-primary-container/35 bg-primary-container/10 text-primary-container hover:bg-primary-container/15'
                : 'bg-primary-container text-on-primary hover:opacity-90'
            } ${selectionPress}`}
          >
            <Icon name={selected ? 'check' : 'add'} size={14} />
            <span>{selected ? t('selectionResult.addedInquiry') : t('selectionResult.addInquiry')}</span>
          </button>
        )}
        {product.categoryCatalogPdf && (
          <a
            href={product.categoryCatalogPdf}
            target="_blank"
            rel="noopener"
            onClick={(event) => {
              event.preventDefault();
              openDocumentUrl(product.categoryCatalogPdf!, { title: t('selectionResult.productCatalog') });
            }}
            className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
          >
            <Icon name="menu_book" size={14} />
            <span>{t('selectionResult.catalog')}</span>
          </a>
        )}
        {product.pdfUrl && (
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
          onClick={() =>
            navigate(`/support`, {
              state: { modelNo: product.modelNo || product.name, specs: product.specs, source: 'selection' as const },
            })
          }
          className={`px-2.5 md:px-3 py-1 md:py-1.5 text-xs md:text-sm font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 inline-flex items-center gap-1 ${selectionPress}`}
        >
          <Icon name="support_agent" size={14} />
          <span>{t('selectionResult.support')}</span>
        </button>
      </div>
    </div>
  );
}
