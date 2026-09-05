import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { cacheModelDetailTitle } from '../../lib/modelDetailTitleCache';
import { useFeatureFlags } from '../../lib/publicSettings';
import { preloadModelDetailPage } from '../../lib/routeLoaders';
import FormatTag from '../shared/FormatTag';
import Icon from '../shared/Icon';
import ModelThumbnail from '../shared/ModelThumbnail';
import { HomeMobileCardContent } from './HomeMobileCardContent';
import type { HomeBrowseState, Product } from './homeTypes';
import { HOME_MOBILE_CARD_CLASS, HOME_MOBILE_ACTION_BUTTON_CLASS } from './homeUtils';

export function ProductCardMobile({
  product,
  onDownload,
  returnPath,
  homeBrowseState,
  onBeforeOpen,
  imageLoading = 'lazy',
  imageFetchPriority = 'auto',
}: {
  product: Product;
  onDownload: (id: string) => void;
  returnPath: string;
  homeBrowseState: HomeBrowseState;
  onBeforeOpen?: (modelId: string) => void;
  imageLoading?: 'eager' | 'lazy';
  imageFetchPriority?: 'high' | 'low' | 'auto';
}) {
  const { t } = useTranslation();
  const featureFlags = useFeatureFlags();
  const detailPath = `/model/${product.id}`;
  const detailState = { from: returnPath, homeBrowseState, modelName: product.name };
  const rememberDetailTitle = useCallback(() => {
    cacheModelDetailTitle(product.id, product.name);
  }, [product.id, product.name]);
  const prepareDetailNavigation = useCallback(() => {
    rememberDetailTitle();
    preloadModelDetailPage();
  }, [rememberDetailTitle]);
  return (
    <div data-home-model-id={product.id} data-home-model-layout="mobile" className={HOME_MOBILE_CARD_CLASS}>
      <HomeMobileCardContent
        media={
          <Link
            to={detailPath}
            state={detailState}
            onPointerDown={prepareDetailNavigation}
            onFocus={prepareDetailNavigation}
            onClick={() => {
              rememberDetailTitle();
              onBeforeOpen?.(product.id);
            }}
            className="block h-full w-full"
          >
            <ModelThumbnail
              src={product.thumbnailUrl}
              alt={product.name}
              className="w-full h-full object-cover"
              loading={imageLoading}
              fetchPriority={imageFetchPriority}
            />
            <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 opacity-70">
              {product.formats.map((f, index) => (
                <FormatTag key={`${f || 'format'}-${index}`} format={f} size="xs" />
              ))}
            </div>
            <span className="absolute top-1.5 right-1.5 text-[7px] text-on-surface-variant/50 bg-black/35 px-1 py-px rounded-sm">
              {product.fileSize}
            </span>
          </Link>
        }
        title={
          <h3 className="text-xs font-headline text-on-surface mb-1.5 leading-tight line-clamp-2">{product.name}</h3>
        }
        action={
          featureFlags.downloads ? (
            <button onClick={() => onDownload(product.id)} className={HOME_MOBILE_ACTION_BUTTON_CLASS}>
              <Icon name="download" size={14} fill />
              {t('common.download')}
            </button>
          ) : null
        }
      />
    </div>
  );
}
