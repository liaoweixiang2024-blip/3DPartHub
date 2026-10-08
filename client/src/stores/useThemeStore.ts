import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncBrowserChromeColor } from '../lib/browserThemeColor';

type Theme = 'dark' | 'light';
type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  theme: Theme;
  themeMode: ThemeMode;
  userExplicitlySet: boolean; // true if user manually toggled theme
  autoSwitchEnabled: boolean;
  autoSwitchDarkHour: number;
  autoSwitchLightHour: number;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAutoSwitch: (enabled: boolean, darkHour: number, lightHour: number) => void;
}

function applyThemeClass(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('theme-light');
  } else {
    document.documentElement.classList.remove('theme-light');
  }
  syncBrowserChromeColor();
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode;
}

let autoSwitchTimer: ReturnType<typeof setInterval> | null = null;

function clearAutoSwitchTimer() {
  if (autoSwitchTimer) {
    clearInterval(autoSwitchTimer);
    autoSwitchTimer = null;
  }
}

function getAutoTheme(darkHour: number, lightHour: number): Theme {
  const hour = new Date().getHours();
  if (hour >= darkHour || hour < lightHour) return 'dark';
  return 'light';
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      themeMode: 'light',
      userExplicitlySet: false,
      autoSwitchEnabled: false,
      autoSwitchDarkHour: 20,
      autoSwitchLightHour: 8,

      toggleTheme: () => {
        const state = get();
        const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
        applyThemeClass(next);
        // Mark as explicitly set by user
        set({ theme: next, themeMode: next, userExplicitlySet: true });
      },

      setTheme: (theme: Theme) => {
        applyThemeClass(theme);
        set({ theme });
      },

      setThemeMode: (mode: ThemeMode) => {
        const resolved = resolveTheme(mode);
        applyThemeClass(resolved);
        set({ themeMode: mode, theme: resolved });
      },

      setAutoSwitch: (enabled: boolean, darkHour: number, lightHour: number) => {
        clearAutoSwitchTimer();
        if (enabled) {
          const autoTheme = getAutoTheme(darkHour, lightHour);
          applyThemeClass(autoTheme);
          set({
            autoSwitchEnabled: true,
            autoSwitchDarkHour: darkHour,
            autoSwitchLightHour: lightHour,
            theme: autoTheme,
            themeMode: 'system',
          });
          autoSwitchTimer = setInterval(() => {
            const state = get();
            if (!state.autoSwitchEnabled) return;
            const next = getAutoTheme(state.autoSwitchDarkHour, state.autoSwitchLightHour);
            if (next !== state.theme) {
              applyThemeClass(next);
              set({ theme: next });
            }
          }, 60_000);
        } else {
          set({ autoSwitchEnabled: false, autoSwitchDarkHour: darkHour, autoSwitchLightHour: lightHour });
        }
      },
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.theme === 'light') {
          document.documentElement.classList.add('theme-light');
        } else {
          document.documentElement.classList.remove('theme-light');
        }
        syncBrowserChromeColor();
        // Restore auto-switch timer if enabled
        if (state.autoSwitchEnabled) {
          state.autoSwitchEnabled = false;
          setTimeout(() => {
            useThemeStore.getState().setAutoSwitch(true, state.autoSwitchDarkHour, state.autoSwitchLightHour);
          }, 0);
        }
      },
    },
  ),
);

// 「跟随系统」要实时听 OS 深/浅色切换：resolveTheme 只在设置瞬间读一次
// prefers-color-scheme，不挂监听的话用户在 OS 层切换后页面要刷新才跟得上。
// 全局只注册一次；非 system 模式或定时自动切换开启时回调里直接让位。
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const systemColorMedia = window.matchMedia('(prefers-color-scheme: light)');
  const handleSystemColorChange = () => {
    const state = useThemeStore.getState();
    if (state.themeMode !== 'system' || state.autoSwitchEnabled) return;
    const next = resolveTheme('system');
    if (next !== state.theme) {
      applyThemeClass(next);
      useThemeStore.setState({ theme: next });
    }
  };
  if (typeof systemColorMedia.addEventListener === 'function') {
    systemColorMedia.addEventListener('change', handleSystemColorChange);
  } else if (typeof (systemColorMedia as unknown as { addListener?: unknown }).addListener === 'function') {
    // 旧 Safari（<14）没有 addEventListener
    (systemColorMedia as unknown as { addListener: (cb: () => void) => void }).addListener(handleSystemColorChange);
  }
}

/**
 * Apply server-configured default theme and auto-switch settings.
 * Called from publicSettings.ts after fetching settings.
 */
export function applyServerThemeDefaults(
  defaultTheme: string,
  autoEnabled: boolean,
  autoDarkHour: number,
  autoLightHour: number,
) {
  const state = useThemeStore.getState();

  if (autoEnabled) {
    // Auto-switch takes priority — always apply
    state.setAutoSwitch(true, autoDarkHour, autoLightHour);
  } else if (!state.userExplicitlySet) {
    // Only apply server default if user hasn't manually toggled theme
    if (defaultTheme === 'system') {
      state.setThemeMode('system');
    } else {
      // 单次 set 同时落 theme 与 themeMode：只改 theme 留下 stale 的
      // themeMode='system'，后续 OS 切换监听会把主题改回去（回跳）
      const resolved = defaultTheme as Theme;
      applyThemeClass(resolved);
      set({ theme: resolved, themeMode: resolved });
    }
  }
}

// Helper to update store from outside
function set(partial: Partial<ThemeState>) {
  useThemeStore.setState(partial);
}
