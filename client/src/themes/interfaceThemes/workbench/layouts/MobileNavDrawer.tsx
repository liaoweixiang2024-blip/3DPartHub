import MobileNavDrawerRenderer from '../../shared/MobileNavDrawerRenderer';
import { workbenchMobileDrawerAppearance } from '../tokens/appearance';

export default function WorkbenchMobileNavDrawer() {
  return <MobileNavDrawerRenderer appearance={workbenchMobileDrawerAppearance} />;
}
