import type { ViewerSettingsOverride } from "../../lib/publicSettings";

export type ViewerTuning = Required<ViewerSettingsOverride>;

export const DEFAULT_VIEWER_TUNING: ViewerTuning = {
  viewer_exposure: 1.05,
  viewer_ambient_intensity: 0.5,
  viewer_main_light_intensity: 1.35,
  viewer_fill_light_intensity: 0.55,
  viewer_hemisphere_intensity: 0.2,
  viewer_bg_color: "#f5f6f8",
  mat_default_color: "#aeb1b5",
  mat_default_metalness: 0.2,
  mat_default_roughness: 0.28,
  mat_default_envMapIntensity: 1.2,
};

export const VIEWER_TUNING_PRESETS: { label: string; value: ViewerTuning }[] = [
  { label: "浅灰 CAD", value: DEFAULT_VIEWER_TUNING },
  {
    label: "黑底灰模",
    value: {
      viewer_exposure: 1.15,
      viewer_ambient_intensity: 0.35,
      viewer_main_light_intensity: 1.55,
      viewer_fill_light_intensity: 0.45,
      viewer_hemisphere_intensity: 0.1,
      viewer_bg_color: "#000000",
      mat_default_color: "#8f9295",
      mat_default_metalness: 0.18,
      mat_default_roughness: 0.22,
      mat_default_envMapIntensity: 1.45,
    },
  },
  {
    label: "柔光白底",
    value: {
      viewer_exposure: 0.95,
      viewer_ambient_intensity: 0.75,
      viewer_main_light_intensity: 1.15,
      viewer_fill_light_intensity: 0.7,
      viewer_hemisphere_intensity: 0.3,
      viewer_bg_color: "#ffffff",
      mat_default_color: "#c3c5c8",
      mat_default_metalness: 0.12,
      mat_default_roughness: 0.35,
      mat_default_envMapIntensity: 0.9,
    },
  },
];

export const VIEWER_TUNING_FIELDS: Array<{ key: keyof ViewerTuning; label: string; min: number; max: number; step: number }> = [
  { key: "viewer_exposure", label: "曝光", min: 0.2, max: 3, step: 0.05 },
  { key: "viewer_ambient_intensity", label: "环境光", min: 0, max: 2, step: 0.05 },
  { key: "viewer_main_light_intensity", label: "主光", min: 0, max: 3, step: 0.05 },
  { key: "viewer_fill_light_intensity", label: "补光", min: 0, max: 2, step: 0.05 },
  { key: "viewer_hemisphere_intensity", label: "半球光", min: 0, max: 2, step: 0.05 },
  { key: "mat_default_metalness", label: "金属度", min: 0, max: 1, step: 0.05 },
  { key: "mat_default_roughness", label: "粗糙度", min: 0, max: 1, step: 0.05 },
  { key: "mat_default_envMapIntensity", label: "反射", min: 0, max: 3, step: 0.05 },
];

export function viewerTuningFromSettings(settings: Partial<ViewerTuning>): ViewerTuning {
  return {
    ...DEFAULT_VIEWER_TUNING,
    ...Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined && value !== null && value !== "")
    ),
  } as ViewerTuning;
}
