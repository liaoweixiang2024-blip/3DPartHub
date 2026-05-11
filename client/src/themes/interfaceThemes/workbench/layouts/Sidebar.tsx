import SidebarRenderer from '../../shared/SidebarRenderer';
import { workbenchSidebarAppearance } from '../tokens/appearance';

export default function WorkbenchSidebar() {
  return <SidebarRenderer appearance={workbenchSidebarAppearance} adminRouteMode="admin-only" />;
}
