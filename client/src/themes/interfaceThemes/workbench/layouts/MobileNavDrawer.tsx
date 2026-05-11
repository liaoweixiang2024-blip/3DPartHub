import MobileNavDrawerRenderer from '../../shared/MobileNavDrawerRenderer';
import type { MobileNavDrawerThemeProps } from '../../types';
import { workbenchMobileDrawerAppearance } from '../tokens/appearance';

export default function WorkbenchMobileNavDrawer(props: MobileNavDrawerThemeProps) {
  return <MobileNavDrawerRenderer {...props} appearance={workbenchMobileDrawerAppearance} />;
}
