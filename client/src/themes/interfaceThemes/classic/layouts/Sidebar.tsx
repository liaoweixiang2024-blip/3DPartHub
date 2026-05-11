import SidebarRenderer from '../../shared/SidebarRenderer';
import { classicSidebarAppearance } from '../tokens/appearance';

export default function ClassicSidebar() {
  return <SidebarRenderer appearance={classicSidebarAppearance} />;
}
