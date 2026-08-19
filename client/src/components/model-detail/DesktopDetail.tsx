import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { getModelDetailCopyright, getModelDetailDisclaimer, useFeatureFlags } from '../../lib/publicSettings';
import type { ModelSpec } from '../../types';
import Icon from '../shared/Icon';
import {
  ModelDetailAsideFrame,
  MODEL_DETAIL_HEADER_TOP_CLASS,
  MODEL_DETAIL_ACTIONS_CLASS,
  MODEL_DETAIL_DOWNLOAD_LIST_CLASS,
  MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS,
  MODEL_DETAIL_SECTION_TITLE_CLASS,
  MODEL_DETAIL_SPEC_GRID_CLASS,
  MODEL_DETAIL_SPEC_ITEM_CLASS,
  MODEL_DETAIL_VARIANTS_CLASS,
} from '../shared/ModelDetailFrame';
import ModelThumbnail from '../shared/ModelThumbnail';
import { checkProtectedAccess } from '../shared/ProtectedLink';
import type { ModelInfo } from './modelDetailUtils';

export function SpecTable({ specs }: { specs: ModelSpec[] }) {
  return (
    <div className="rounded-sm border border-outline-variant/10 overflow-hidden divide-y divide-outline-variant/10">
      {specs.map((spec, i) => (
        <div
          key={`${spec.label || 'spec'}-${i}`}
          className={`flex items-center justify-between px-4 py-2.5 text-sm ${
            i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface-container-high'
          }`}
        >
          <span className="text-on-secondary-container">{spec.label}</span>
          <span className="text-on-surface font-medium text-right ml-4 font-mono">{spec.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DesktopDetail({
  modelData,
  isFav,
  isAdmin,
  onToggleFav,
  onEdit,
  onShare,
  categoryBreadcrumb,
  onDownload,
  onOpenDrawing,
  onLoginDialog,
}: {
  modelData: ModelInfo;
  isFav: boolean;
  isAdmin?: boolean;
  onToggleFav: () => void;
  onEdit?: () => void;
  onShare: () => void;
  categoryBreadcrumb: { id: string; name: string }[];
  onDownload: (id: string, format?: string) => void;
  onOpenDrawing: (id: string) => void;
  onLoginDialog: (reason: string) => void;
}) {
  const { i18n, t } = useTranslation();
  const featureFlags = useFeatureFlags();
  return (
    <ModelDetailAsideFrame
      header={
        <>
          <div className={MODEL_DETAIL_HEADER_TOP_CLASS}>
            <div>
              <div className="flex items-center gap-1.5 text-[11px] tracking-[0.05em] uppercase text-on-surface-variant mb-2.5">
                <Link to="/" className="hover:text-primary transition-colors">
                  {t('modelDetail.categoryFallback')}
                </Link>
                {categoryBreadcrumb.map((cat, i) => (
                  <span key={`${cat.id || cat.name || 'category'}-${i}`} className="flex items-center gap-1.5">
                    <Icon name="chevron_right" size={12} className="text-on-surface-variant/40" />
                    <Link
                      to="/"
                      state={{ homeBrowseState: { categoryId: cat.id, page: 1 } }}
                      className={`hover:text-primary transition-colors ${i === categoryBreadcrumb.length - 1 ? 'text-primary' : ''}`}
                    >
                      {cat.name}
                    </Link>
                  </span>
                ))}
              </div>
              <h1 className="font-headline text-3xl font-bold text-on-surface tracking-tight mb-1.5">
                {modelData.name}
              </h1>
            </div>
            {isAdmin && onEdit && (
              <button
                onClick={onEdit}
                className="p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container-high rounded-sm transition-colors border border-outline-variant/20 shrink-0"
                aria-label={t('modelDetail.editModel')}
                data-tooltip={t('modelDetail.editModel')}
                data-tooltip-side="bottom"
              >
                <Icon name="settings" size={20} />
              </button>
            )}
          </div>
          <div className={MODEL_DETAIL_ACTIONS_CLASS}>
            {featureFlags.downloads && (
              <button
                onClick={() => onDownload(modelData.id, 'original')}
                className="flex-1 bg-primary-container text-on-primary rounded-sm py-2 px-4 text-sm font-medium hover:bg-primary transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Icon name="download" size={18} />
                {t('modelDetail.downloadModel')}
              </button>
            )}
            {featureFlags.shares && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onShare}
                aria-label={t('common.share')}
                data-tooltip={t('common.share')}
                data-tooltip-side="bottom"
                className="bg-surface-container-high border border-outline/40 hover:border-outline text-on-surface rounded-sm p-2 transition-all flex items-center justify-center"
              >
                <Icon name="share" size={20} />
              </motion.button>
            )}
            {featureFlags.favorites && (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={onToggleFav}
                aria-label={isFav ? t('productCard.unfavorite') : t('productCard.favorite')}
                data-tooltip={isFav ? t('productCard.unfavorite') : t('productCard.favorite')}
                data-tooltip-side="bottom"
                className={`bg-surface-container-high border ${isFav ? 'border-primary/50' : 'border-outline/40'} hover:border-outline text-on-surface rounded-sm p-2 transition-all flex items-center justify-center`}
              >
                <Icon
                  name={isFav ? 'bookmark' : 'bookmark_border'}
                  size={20}
                  className={`${isFav ? 'text-primary' : ''}`}
                  fill={isFav}
                />
              </motion.button>
            )}
          </div>
        </>
      }
      specs={
        <>
          <h3 className={MODEL_DETAIL_SECTION_TITLE_CLASS}>{t('modelDetail.techSpecs')}</h3>
          <div className={MODEL_DETAIL_SPEC_GRID_CLASS}>
            {modelData.specs.map((spec, index) => (
              <div key={`${spec.label || 'spec'}-${index}`} className={MODEL_DETAIL_SPEC_ITEM_CLASS}>
                <span className="text-xs text-on-secondary-container mb-1">{spec.label}</span>
                <span className="text-sm font-medium text-on-surface">{spec.value}</span>
              </div>
            ))}
          </div>
        </>
      }
      variants={
        modelData.variants && modelData.variants.length > 1 ? (
          <div className={MODEL_DETAIL_VARIANTS_CLASS}>
            <h3 className={MODEL_DETAIL_SECTION_TITLE_CLASS}>
              {t('modelDetail.versions', { count: modelData.variants.length })}
            </h3>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {modelData.variants.map((v, index) => {
                const isCurrent = v.model_id === modelData.id;
                const variantKey = `${v.model_id || v.original_name || 'variant'}-${index}`;
                return isCurrent ? (
                  <div key={variantKey} className="shrink-0">
                    <div className="w-20 h-20 rounded-md border-2 border-primary bg-surface-container-lowest overflow-hidden relative">
                      <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-on-primary text-[9px] text-center py-0.5 font-medium">
                        {t('modelDetail.current')}
                      </div>
                      {v.is_primary && (
                        <div className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] px-1 rounded-sm">
                          {t('modelDetail.primaryVersion')}
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-primary mt-1 text-center w-20 truncate" title={v.original_name}>
                      {v.original_name.replace(/\.[^.]+$/, '')}
                    </p>
                    {v.file_modified_at && (
                      <p className="text-[9px] text-on-surface-variant/40 text-center">
                        {new Date(v.file_modified_at).toLocaleDateString(i18n.language)}
                      </p>
                    )}
                  </div>
                ) : (
                  <Link key={variantKey} to={`/model/${v.model_id}`} className="shrink-0 group">
                    <div className="w-20 h-20 rounded-md border border-outline-variant/30 bg-surface-container-lowest overflow-hidden hover:border-primary/50 transition-colors relative">
                      <ModelThumbnail src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      {v.is_primary && (
                        <div className="absolute top-1 left-1 bg-primary/80 text-on-primary text-[7px] px-1 rounded-sm">
                          {t('modelDetail.primaryVersion')}
                        </div>
                      )}
                    </div>
                    <p
                      className="text-[10px] text-on-surface-variant group-hover:text-primary mt-1 text-center w-20 truncate"
                      title={v.original_name}
                    >
                      {v.original_name.replace(/\.[^.]+$/, '')}
                    </p>
                    {v.file_modified_at && (
                      <p className="text-[9px] text-on-surface-variant/40 text-center">
                        {new Date(v.file_modified_at).toLocaleDateString(i18n.language)}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null
      }
      downloads={
        featureFlags.downloads ? (
          <>
            <h3 className={MODEL_DETAIL_SECTION_TITLE_CLASS}>{t('modelDetail.fileDownloads')}</h3>
            <div className={MODEL_DETAIL_DOWNLOAD_LIST_CLASS}>
              {modelData.downloads.map((file, index) => {
                const downloadKey = `${file.downloadFormat || file.format || file.fileName || 'download'}-${index}`;
                return file.downloadFormat === 'drawing' ? (
                  <button
                    key={downloadKey}
                    type="button"
                    onClick={() => onOpenDrawing(modelData.id)}
                    className={`${MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS} cursor-pointer text-left`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-error/10 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-error">PDF</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-on-surface truncate">{file.fileName}</div>
                        <div className="text-[11px] text-on-surface-variant mt-0.5">
                          {file.format} · {file.size}
                        </div>
                      </div>
                    </div>
                    <div className="text-primary hover:text-primary-container p-2">
                      <Icon name="open_in_new" size={20} />
                    </div>
                  </button>
                ) : (
                  <button
                    key={downloadKey}
                    type="button"
                    onClick={() =>
                      onDownload(modelData.id, file.downloadFormat === 'original' ? 'original' : undefined)
                    }
                    className={`${MODEL_DETAIL_DOWNLOAD_ROW_INTERACTIVE_CLASS} cursor-pointer text-left`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-primary-container/10 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-primary-container">{file.format.slice(0, 4)}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-on-surface font-mono flex min-w-0">
                          <span className="truncate">
                            {file.fileName || `${modelData.name}.${file.format.toLowerCase()}`}
                          </span>
                        </div>
                        <div className="text-[11px] text-on-surface-variant mt-0.5">
                          {file.format} · {file.size}
                        </div>
                      </div>
                    </div>
                    <div className="text-primary group-hover:text-primary-container p-2" aria-hidden="true">
                      <Icon name="download" size={20} />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : null
      }
      support={
        <>
          {featureFlags.tickets && (
            <Link
              to="/support"
              state={{
                modelName: modelData.name,
                modelNo: modelData.name,
                sourceUrl: `/model/${modelData.id}`,
                specs: Object.fromEntries(modelData.specs.map((s) => [s.label, s.value])),
                source: 'model',
              }}
              onClick={(e) => {
                const result = checkProtectedAccess('/support');
                if (result.action === 'dialog' || result.action === 'redirect') {
                  e.preventDefault();
                  onLoginDialog(result.action === 'dialog' ? result.reason : t('modelDetail.supportReason'));
                }
              }}
              className="flex items-center gap-3 p-3 rounded-sm bg-surface-container-high hover:bg-surface-container-highest transition-colors group"
            >
              <div className="w-10 h-10 rounded-full bg-primary-container/15 flex items-center justify-center shrink-0">
                <Icon
                  name="support_agent"
                  size={20}
                  className="text-primary group-hover:text-on-primary transition-colors"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-on-surface">{t('modelDetail.customSupportTitle')}</p>
                <p className="text-xs text-on-surface-variant mt-0.5">{t('modelDetail.customSupportDescription')}</p>
              </div>
              <Icon
                name="chevron_right"
                size={20}
                className="text-on-surface-variant/40 group-hover:text-on-surface transition-colors"
              />
            </Link>
          )}

          <div className="pt-2 space-y-1.5">
            <p className="text-xs text-on-surface-variant/50 leading-relaxed">{getModelDetailDisclaimer()}</p>
            <p className="text-xs text-on-surface-variant/30">{getModelDetailCopyright()}</p>
          </div>
        </>
      }
    />
  );
}
