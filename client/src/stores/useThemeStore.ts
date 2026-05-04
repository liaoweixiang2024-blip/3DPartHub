import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
      state.setTheme(defaultTheme as Theme);
      set({ themeMode: defaultTheme as ThemeMode });
    }
  }
}

// Helper to update store from outside
function set(partial: Partial<ThemeState>) {
  useThemeStore.setState(partial);
}
