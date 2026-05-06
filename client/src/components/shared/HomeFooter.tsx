import { memo } from 'react';
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
  return (
    <footer className="shrink-0 border-t border-outline-variant/10 bg-surface-container-low">
      <div className="px-8 py-4">
        <div className="flex items-center justify-between gap-8">
          <span className="font-headline font-semibold text-sm text-on-surface-variant/60">{getSiteTitle()}</span>
          <div className="flex items-center gap-5">
            {getFooterLinks().map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-on-surface-variant/40 hover:text-on-surface-variant/70 transition-colors"
              >
                {link.label}
              </a>
            ))}
            {getContactEmail() && (
              <a
                href={`mailto:${getContactEmail()}`}
                className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
              >
                <Icon name="mail" size={13} />
                <span>{getContactEmail()}</span>
              </a>
            )}
            {getContactPhone() && (
              <a
                href={`tel:${getContactPhone()}`}
                className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 hover:text-primary transition-colors"
              >
                <Icon name="phone" size={13} />
                <span>{getContactPhone()}</span>
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2.5">
          <p className="text-[10px] text-on-surface-variant/25">
            {getFooterCopyright() || `© ${new Date().getFullYear()} ${getSiteTitle()}. All rights reserved.`}
          </p>
          {getContactAddress() && (
            <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/25">
              <Icon name="domain" size={11} />
              {getContactAddress()}
            </span>
          )}
        </div>
      </div>
    </footer>
  );
});

export default HomeFooter;
