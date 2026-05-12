import { type ModelPreviewMeta } from '../../api/models';
import { getDefaultPreset, getPublicSettingsSnapshot } from '../../lib/publicSettings';
import type { ModelSpec, ModelDownload } from '../../types';
import type { ViewMode, CameraPreset } from '../3d/ModelViewer';
import { MATERIAL_PRESETS, VIEW_MODES, type MaterialPresetKey } from '../3d/viewerControls';

export interface ModelVariant {
  model_id: string;
  name: string;
  thumbnail_url: string | null;
  original_name: string;
  original_size: number;
  is_primary: boolean;
  created_at: string;
  file_modified_at?: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  subtitle: string;
  format: string;
  fileSize: string;
  createdAtLabel: string;
  category: string;
  categoryId?: string;
  specs: ModelSpec[];
  downloads: ModelDownload[];
  dimensions: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  drawingUrl?: string;
  groupId?: string;
  groupName?: string;
  variants?: ModelVariant[];
  previewMeta?: ModelPreviewMeta | null;
}

type ViewerDisplayPrefs = {
  activeView: ViewMode;
  activeCamera: CameraPreset;
  showDimensions: boolean;
  materialPreset: MaterialPresetKey;
  showEdges: boolean;
  showAxis: boolean;
};

const VIEWER_DISPLAY_PREFS_KEY = 'model_viewer_display_prefs_v1';
const DEFAULT_VIEWER_DISPLAY_PREFS: ViewerDisplayPrefs = {
  activeView: 'solid',
  activeCamera: 'iso',
  showDimensions: false,
  materialPreset: (getDefaultPreset() as MaterialPresetKey) || 'default',
  showEdges: getPublicSettingsSnapshot().viewer_edge_enabled !== false,
  showAxis: false,
};

type ModelDetailLocationState = {
  from?: string;
  modelName?: string | null;
  homeBrowseState?: {
    categoryId?: string;
    query?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
    restoreKey?: string;
  } | null;
} | null;

const HOME_SCROLL_TARGET_PREFIX = 'home_model_scroll_target:';
const HOME_BROWSE_STATE_PREFIX = 'home_model_browse_state:';
const HOME_SCROLL_RESTORE_PENDING_KEY = 'home_model_scroll_restore_pending_v1';

function markHomeRestorePending(
  homeBrowseState: NonNullable<ModelDetailLocationState>['homeBrowseState'],
  modelId?: string,
) {
  if (typeof window === 'undefined' || !homeBrowseState?.restoreKey) return;
  try {
    const restoreKey = homeBrowseState.restoreKey;
    window.sessionStorage.setItem(`${HOME_BROWSE_STATE_PREFIX}${restoreKey}`, JSON.stringify(homeBrowseState));
    if (modelId) window.sessionStorage.setItem(`${HOME_SCROLL_TARGET_PREFIX}${restoreKey}`, modelId);
    window.sessionStorage.setItem(HOME_SCROLL_RESTORE_PENDING_KEY, restoreKey);
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function getViewerDisplayPrefs(): ViewerDisplayPrefs {
  if (typeof window === 'undefined') return DEFAULT_VIEWER_DISPLAY_PREFS;
  try {
    const raw = window.localStorage.getItem(VIEWER_DISPLAY_PREFS_KEY);
    if (!raw) return DEFAULT_VIEWER_DISPLAY_PREFS;
    const parsed = JSON.parse(raw) as Partial<ViewerDisplayPrefs>;
    const rawView = VIEW_MODES.some((mode) => mode.key === parsed.activeView)
      ? parsed.activeView
      : DEFAULT_VIEWER_DISPLAY_PREFS.activeView;
    const view = rawView === 'solid' ? rawView : DEFAULT_VIEWER_DISPLAY_PREFS.activeView;
    const material = MATERIAL_PRESETS.some((preset) => preset.key === parsed.materialPreset)
      ? parsed.materialPreset
      : DEFAULT_VIEWER_DISPLAY_PREFS.materialPreset;
    return {
      activeView: view as ViewMode,
      activeCamera: DEFAULT_VIEWER_DISPLAY_PREFS.activeCamera,
      showDimensions:
        typeof parsed.showDimensions === 'boolean'
          ? parsed.showDimensions
          : DEFAULT_VIEWER_DISPLAY_PREFS.showDimensions,
      materialPreset: material as MaterialPresetKey,
      showEdges: DEFAULT_VIEWER_DISPLAY_PREFS.showEdges,
      showAxis: typeof parsed.showAxis === 'boolean' ? parsed.showAxis : DEFAULT_VIEWER_DISPLAY_PREFS.showAxis,
    };
  } catch {
    return DEFAULT_VIEWER_DISPLAY_PREFS;
  }
}

function saveViewerDisplayPrefs(prefs: ViewerDisplayPrefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIEWER_DISPLAY_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore private browsing or storage quota failures.
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type { ViewerDisplayPrefs, ModelDetailLocationState };
export {
  VIEWER_DISPLAY_PREFS_KEY,
  DEFAULT_VIEWER_DISPLAY_PREFS,
  HOME_SCROLL_TARGET_PREFIX,
  HOME_BROWSE_STATE_PREFIX,
  HOME_SCROLL_RESTORE_PENDING_KEY,
  markHomeRestorePending,
  getViewerDisplayPrefs,
  saveViewerDisplayPrefs,
  formatFileSize,
};
