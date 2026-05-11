import BottomNavRenderer from '../../shared/BottomNavRenderer';
import { workbenchBottomNavAppearance } from '../tokens/appearance';

export default function WorkbenchBottomNav() {
  return <BottomNavRenderer appearance={workbenchBottomNavAppearance} />;
}
