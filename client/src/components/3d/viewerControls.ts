import type { CameraPreset, ViewMode } from './ModelViewer';

export type MaterialPresetKey = 'original' | 'default' | 'metal' | 'plastic' | 'glass';

export const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'solid', label: 'Solid', icon: 'deployed_code' },
  { key: 'wireframe', label: 'Wireframe', icon: 'grid_4x4' },
  { key: 'transparent', label: 'Transparent', icon: 'layers' },
  { key: 'explode', label: 'Exploded', icon: 'zoom_out_map' },
];

export const CAMERA_ANGLES: { key: CameraPreset; label: string; icon: string }[] = [
  { key: 'front', label: 'Front', icon: 'square' },
  { key: 'back', label: 'Back', icon: 'view_icon' },
  { key: 'left', label: 'Left', icon: 'chevron_left' },
  { key: 'right', label: 'Right', icon: 'chevron_right' },
  { key: 'top', label: 'Top', icon: 'crop_free' },
  { key: 'bottom', label: 'Bottom', icon: 'view_in_ar' },
  { key: 'iso', label: 'Isometric', icon: 'box_icon' },
];

export const MATERIAL_PRESETS: { key: MaterialPresetKey; label: string; icon: string }[] = [
  { key: 'original', label: 'Original', icon: 'palette' },
  { key: 'default', label: 'Smart gray', icon: 'tonality' },
  { key: 'metal', label: 'Metal', icon: 'hexagon' },
  { key: 'plastic', label: 'Plastic', icon: 'category_all' },
  { key: 'glass', label: 'Glass', icon: 'opacity' },
];
