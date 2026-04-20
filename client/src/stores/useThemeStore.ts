import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark",
      toggleTheme: () =>
        set((state) => {
          const next = state.theme === "dark" ? "light" : "dark";
          if (next === "light") {
            document.documentElement.classList.add("theme-light");
          } else {
            document.documentElement.classList.remove("theme-light");
          }
          return { theme: next };
        }),
      setTheme: (theme) => {
        if (theme === "light") {
          document.documentElement.classList.add("theme-light");
        } else {
          document.documentElement.classList.remove("theme-light");
        }
        set({ theme });
      },
    }),
    {
      name: "theme-storage",
      onRehydrateStorage: () => (state) => {
        if (state?.theme === "light") {
          document.documentElement.classList.add("theme-light");
        }
      },
    }
  )
);
