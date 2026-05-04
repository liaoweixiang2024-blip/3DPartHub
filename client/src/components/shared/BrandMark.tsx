import type { ReactNode } from 'react';
import { getLogoDisplayMode, getSiteIcon, getSiteLogo, getSiteTitle } from '../../lib/publicSettings';
import Icon from './Icon';
import SafeImage from './SafeImage';

type BrandMarkSize = 'compact' | 'nav' | 'hero';

interface BrandMarkProps {
  size?: BrandMarkSize;
  centered?: boolean;
  className?: string;
  titleSuffix?: ReactNode;
}

const sizeClass = {
  compact: {
    iconBox: 'h-6 w-6',
    logo: 'h-7 max-w-[128px]',
    title: 'text-sm',
    gap: 'gap-1',
    fallback: 20,
  },
  nav: {
    iconBox: 'h-7 w-7',
    logo: 'h-9 max-w-[176px]',
    title: 'text-sm',
    gap: 'gap-1.5',
    fallback: 26,
  },
  hero: {
    iconBox: 'h-10 w-10',
    logo: 'h-12 max-w-[240px]',
    title: 'text-xl',
    gap: 'gap-2',
    fallback: 44,
  },
};

export default function BrandMark({ size = 'nav', centered = false, className = '', titleSuffix }: BrandMarkProps) {
  const displayMode = getLogoDisplayMode();
  const siteLogo = getSiteLogo();
  const siteIcon = getSiteIcon();
  const siteTitle = getSiteTitle();
  const cfg = sizeClass[size];

  const title = (
    <span
      className={`${cfg.title} min-w-0 truncate font-headline font-bold leading-none tracking-tight text-on-surface`}
    >
      {siteTitle}
    </span>
  );

  const image = (src: string, kind: 'icon' | 'logo') => (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${kind === 'logo' ? cfg.logo : cfg.iconBox}`}
      aria-hidden="true"
    >
      <SafeImage
        src={src}
        alt=""
        className="block max-h-full max-w-full object-contain align-middle"
        fallbackIcon="view_in_ar"
      />
    </span>
  );

  const fallbackIcon = <Icon name="view_in_ar" size={cfg.fallback} className="shrink-0 text-primary-container" />;

  let content: ReactNode;
  if (displayMode === 'title_only') {
    content = title;
  } else if (displayMode === 'logo_only' && siteLogo) {
    content = image(siteLogo, 'logo');
  } else if (displayMode === 'logo_and_title') {
    content = (
      <>
        {siteIcon ? image(siteIcon, 'icon') : siteLogo ? image(siteLogo, 'icon') : fallbackIcon}
        {title}
      </>
    );
  } else {
    content = (
      <>
        {fallbackIcon}
        {title}
      </>
    );
  }

  return (
    <span
      className={`flex min-w-0 items-center ${centered ? 'justify-center' : ''} ${cfg.gap} leading-none ${className}`}
    >
      {content}
      {titleSuffix}
    </span>
  );
}
