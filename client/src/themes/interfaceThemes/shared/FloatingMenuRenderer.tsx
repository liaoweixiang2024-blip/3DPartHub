import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '../../../components/shared/Icon';
import { preloadRouteForPath } from '../../../lib/routeLoaders';

export interface FloatingMenuItem {
  to: string;
  icon: string;
  label: string;
}

export interface FloatingMenuAppearance {
  rootClassName: string;
  itemClassName: string;
  activeItemClassName: string;
  contactPanelClassName: string;
  contactHeaderClassName: string;
  contactListClassName: string;
  contactRowClassName: string;
  contactLabelClassName: string;
  contactValueClassName: string;
  contactEmptyClassName: string;
  contactActionClassName: string;
  iconSize: number;
  contactRowIconSize: number;
}

interface FloatingMenuRendererProps {
  appearance: FloatingMenuAppearance;
  contactAddress?: string;
  contactActionTo: string;
  contactActionIcon: string;
  contactActionLabel: string;
  contactEmail?: string;
  contactIcon: string;
  contactLabel: string;
  contactPanelLabel: string;
  contactPhone?: string;
  homeItems: FloatingMenuItem[];
  tailItems?: FloatingMenuItem[];
  topIcon: string;
  topLabel: string;
}

function scrollContainerToTop(element: HTMLElement) {
  if (element.scrollHeight <= element.clientHeight + 1) return;
  element.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollCurrentPageToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const centerElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
  let current: Element | null = centerElement;
  while (current && current instanceof HTMLElement) {
    scrollContainerToTop(current);
    current = current.parentElement;
  }

  document
    .querySelectorAll<HTMLElement>('.home-scroll-container, main.custom-scrollbar, .model-list-scrollbar')
    .forEach(scrollContainerToTop);
}

function FloatingMenuLink({ appearance, to, icon, label }: FloatingMenuItem & { appearance: FloatingMenuAppearance }) {
  const location = useLocation();
  const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(`${to}/`));

  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onPointerEnter={() => preloadRouteForPath(to)}
      onPointerDown={() => preloadRouteForPath(to)}
      onFocus={() => preloadRouteForPath(to)}
      className={`${appearance.itemClassName} ${active ? appearance.activeItemClassName : ''}`}
    >
      <Icon name={icon} size={appearance.iconSize} />
      <span>{label}</span>
    </Link>
  );
}

export default function FloatingMenuRenderer({
  appearance,
  contactAddress = '',
  contactActionTo,
  contactActionIcon,
  contactActionLabel,
  contactEmail = '',
  contactIcon,
  contactLabel,
  contactPanelLabel,
  contactPhone = '',
  homeItems,
  tailItems = [],
  topIcon,
  topLabel,
}: FloatingMenuRendererProps) {
  const location = useLocation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [contactOpen, setContactOpen] = useState(false);

  const contactRows = useMemo(
    () =>
      [
        contactPhone ? { icon: 'phone', label: '电话', value: contactPhone, href: `tel:${contactPhone}` } : null,
        contactEmail ? { icon: 'mail', label: '邮箱', value: contactEmail, href: `mailto:${contactEmail}` } : null,
        contactAddress ? { icon: 'domain', label: '地址', value: contactAddress } : null,
      ].filter(Boolean) as Array<{ icon: string; label: string; value: string; href?: string }>,
    [contactAddress, contactEmail, contactPhone],
  );

  const handleBackToTop = useCallback(() => {
    scrollCurrentPageToTop();
    setContactOpen(false);
  }, []);

  useEffect(() => {
    setContactOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!contactOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      setContactOpen(false);
    }

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [contactOpen]);

  return (
    <aside className={appearance.rootClassName} aria-label="快捷操作" ref={panelRef}>
      <button type="button" className={appearance.itemClassName} aria-label={topLabel} onClick={handleBackToTop}>
        <Icon name={topIcon} size={appearance.iconSize} />
        <span>{topLabel}</span>
      </button>
      {homeItems.map((item) => (
        <FloatingMenuLink key={item.to} appearance={appearance} {...item} />
      ))}
      <button
        type="button"
        className={`${appearance.itemClassName} ${contactOpen ? appearance.activeItemClassName : ''}`}
        aria-label={contactLabel}
        aria-expanded={contactOpen}
        onClick={() => setContactOpen((open) => !open)}
      >
        <Icon name={contactIcon} size={appearance.iconSize} />
        <span>{contactLabel}</span>
      </button>
      <FloatingMenuLink
        appearance={appearance}
        to={contactActionTo}
        icon={contactActionIcon}
        label={contactActionLabel}
      />
      {tailItems.map((item) => (
        <FloatingMenuLink key={item.to} appearance={appearance} {...item} />
      ))}

      {contactOpen ? (
        <div className={appearance.contactPanelClassName} role="dialog" aria-label={contactPanelLabel}>
          <div className={appearance.contactHeaderClassName}>
            <span>{contactPanelLabel}</span>
            <button type="button" aria-label={`关闭${contactPanelLabel}`} onClick={() => setContactOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          {contactRows.length > 0 ? (
            <div className={appearance.contactListClassName}>
              {contactRows.map((row) => {
                const content = (
                  <>
                    <Icon name={row.icon} size={appearance.contactRowIconSize} />
                    <span className={appearance.contactLabelClassName}>{row.label}</span>
                    <span className={appearance.contactValueClassName}>{row.value}</span>
                  </>
                );
                return row.href ? (
                  <a key={row.label} href={row.href} className={appearance.contactRowClassName}>
                    {content}
                  </a>
                ) : (
                  <div key={row.label} className={appearance.contactRowClassName}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={appearance.contactEmptyClassName}>后台暂未配置联系电话、邮箱或地址。</p>
          )}
          <Link to={contactActionTo} className={appearance.contactActionClassName}>
            <Icon name={contactActionIcon} size={appearance.contactRowIconSize} />
            前往{contactActionLabel}
          </Link>
        </div>
      ) : null}
    </aside>
  );
}
