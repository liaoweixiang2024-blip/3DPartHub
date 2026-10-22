import MobileNavDrawerRenderer from '../../shared/MobileNavDrawerRenderer';
import { classicMobileDrawerAppearance } from '../tokens/appearance';

export default function ClassicMobileNavDrawer() {
  return <MobileNavDrawerRenderer appearance={classicMobileDrawerAppearance} />;
}
