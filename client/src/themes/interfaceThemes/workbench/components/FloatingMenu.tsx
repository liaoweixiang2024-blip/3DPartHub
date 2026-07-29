import { useTranslation } from 'react-i18next';
import FloatingMenuRenderer from '../../shared/FloatingMenuRenderer';
import type { FloatingMenuThemeProps } from '../../types';

const floatingMenuAppearance = {
  rootClassName: 'workbench-floating-menu',
  itemClassName: 'workbench-floating-menu-item',
  activeItemClassName: 'workbench-floating-menu-item-active',
  contactPanelClassName: 'workbench-floating-contact-panel',
  contactHeaderClassName: 'workbench-floating-contact-header',
  contactListClassName: 'workbench-floating-contact-list',
  contactRowClassName: 'workbench-floating-contact-row',
  contactLabelClassName: 'workbench-floating-contact-label',
  contactValueClassName: 'workbench-floating-contact-value',
  contactEmptyClassName: 'workbench-floating-contact-empty',
  contactActionClassName: 'workbench-floating-contact-action',
  iconSize: 18,
  contactRowIconSize: 15,
};

export default function FloatingMenu({
  contactAddress,
  contactEmail,
  contactPhone,
  ticketsEnabled,
}: FloatingMenuThemeProps) {
  const { t } = useTranslation();
  const showTickets = ticketsEnabled !== false;
  const floatingMenuItems = [{ to: '/', icon: 'dashboard', label: t('nav.home') }];
  const floatingMenuTailItems = [
    ...(showTickets ? [{ to: '/my-tickets', icon: 'assignment_add', label: t('nav.short.tickets') }] : []),
    { to: '/my-inquiries', icon: 'request_quote', label: t('nav.short.inquiries') },
  ];

  return (
    <FloatingMenuRenderer
      appearance={floatingMenuAppearance}
      contactAddress={contactAddress}
      contactActionTo={showTickets ? '/support' : undefined}
      contactActionIcon={showTickets ? 'support_agent' : undefined}
      contactActionLabel={showTickets ? t('nav.support') : undefined}
      contactEmail={contactEmail}
      contactIcon="phone"
      contactLabel={t('floatingMenu.contact')}
      contactPanelLabel={t('floatingMenu.contactInfo')}
      contactPhone={contactPhone}
      homeItems={floatingMenuItems}
      tailItems={floatingMenuTailItems}
      topIcon="chevrons_up"
      topLabel={t('floatingMenu.top')}
    />
  );
}
