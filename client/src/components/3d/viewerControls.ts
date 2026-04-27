import type { CameraPreset, ViewMode } from "./ModelViewer";

export type MaterialPresetKey = "original" | "default" | "metal" | "plastic" | "glass";

export const VIEW_MODES: { key: ViewMode; label: string; icon: string }[] = [
  { key: "solid", label: "实体", icon: "deployed_code" },
  { key: "wireframe", label: "线框", icon: "grid_4x4" },
  { key: "transparent", label: "透明", icon: "layers" },
  { key: "explode", label: "爆炸", icon: "zoom_out_map" },
];

export const CAMERA_ANGLES: { key: CameraPreset; label: string; icon: string }[] = [
  { key: "front", label: "正视", icon: "square" },
  { key: "back", label: "后视", icon: "view_icon" },
  { key: "left", label: "左视", icon: "chevron_left" },
  { key: "right", label: "右视", icon: "chevron_right" },
  { key: "top", label: "俯视", icon: "crop_free" },
  { key: "bottom", label: "仰视", icon: "view_in_ar" },
  { key: "iso", label: "等轴测", icon: "box_icon" },
];

export const MATERIAL_PRESETS: { key: MaterialPresetKey; label: string; icon: string }[] = [
  { key: "original", label: "原色", icon: "palette" },
  { key: "default", label: "智能灰", icon: "tonality" },
  { key: "metal", label: "金属", icon: "hexagon" },
  { key: "plastic", label: "塑料", icon: "category_all" },
  { key: "glass", label: "玻璃", icon: "opacity" },
];
