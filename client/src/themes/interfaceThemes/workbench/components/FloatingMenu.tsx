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

const floatingMenuItems = [{ to: '/', icon: 'dashboard', label: '首页' }];

const floatingMenuTailItems = [
  { to: '/my-tickets', icon: 'assignment_add', label: '工单' },
  { to: '/my-inquiries', icon: 'request_quote', label: '询价' },
];

export default function FloatingMenu({ contactAddress, contactEmail, contactPhone }: FloatingMenuThemeProps) {
  return (
    <FloatingMenuRenderer
      appearance={floatingMenuAppearance}
      contactAddress={contactAddress}
      contactActionTo="/support"
      contactActionIcon="support_agent"
      contactActionLabel="技术支持"
      contactEmail={contactEmail}
      contactIcon="phone"
      contactLabel="联系"
      contactPanelLabel="联系信息"
      contactPhone={contactPhone}
      homeItems={floatingMenuItems}
      tailItems={floatingMenuTailItems}
      topIcon="chevrons_up"
      topLabel="顶部"
    />
  );
}
