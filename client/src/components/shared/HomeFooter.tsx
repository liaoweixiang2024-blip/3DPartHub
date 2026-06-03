import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getSiteTitle,
  getFooterLinks,
  getFooterCopyright,
  getContactEmail,
  getContactPhone,
  getContactAddress,
} from '../../lib/publicSettings';
import Icon from './Icon';

const HomeFooter = memo(function HomeFooter() {
  const { t } = useTranslation();
  const footerLinks = getFooterLinks();

  return (
    <footer className="shrink-0 border-t border-outline-variant/10 bg-surface-container-low">
      <div className="px-4 py-4 sm:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8">
          <div className="min-w-0">
            <span className="font-headline text-sm font-semibold text-on-surface-variant/60">{getSiteTitle()}</span>
            <p className="mt-1 text-[10px] text-on-surface-variant/30">{getFooterCopyright()}</p>
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 md:justify-end">
              {getContactEmail() && (
                <a
                  href={`mailto:${getContactEmail()}`}
                  className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 transition-colors hover:text-primary"
                >
                  <Icon name="mail" size={13} />
                  <span>{getContactEmail()}</span>
                </a>
              )}
              {getContactPhone() && (
                <a
                  href={`tel:${getContactPhone()}`}
                  className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 transition-colors hover:text-primary"
                >
                  <Icon name="phone" size={13} />
                  <span>{getContactPhone()}</span>
                </a>
              )}
            </div>
            {footerLinks.length > 0 && (
              <nav
                aria-label={t('home.footerLinks')}
                className="flex max-w-md flex-wrap items-center gap-x-3 gap-y-1 md:justify-end"
              >
                <span className="text-[10px] font-medium text-on-surface-variant/35">{t('home.footerLinks')}</span>
                {footerLinks.map((link, i) => (
                  <a
                    key={`${link.label}-${i}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] leading-5 text-on-surface-variant/50 underline-offset-4 transition-colors hover:text-primary hover:underline"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            )}
          </div>
        </div>
        {getContactAddress() && (
          <div className="mt-2.5 flex items-center text-[10px] text-on-surface-variant/30 md:justify-end">
            <span className="flex items-center gap-1">
              <Icon name="domain" size={11} />
              {getContactAddress()}
            </span>
          </div>
        )}
      </div>
    </footer>
  );
});

export default HomeFooter;
