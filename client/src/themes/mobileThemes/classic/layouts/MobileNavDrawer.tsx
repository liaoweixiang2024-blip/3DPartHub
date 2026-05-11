import MobileNavDrawerRenderer from '../../shared/MobileNavDrawerRenderer';
import type { MobileNavDrawerThemeProps } from '../../types';
import { classicMobileDrawerAppearance } from '../tokens/appearance';

export default function ClassicMobileNavDrawer(props: MobileNavDrawerThemeProps) {
  return <MobileNavDrawerRenderer {...props} appearance={classicMobileDrawerAppearance} />;
}
