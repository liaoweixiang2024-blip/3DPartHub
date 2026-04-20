import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DownloadItem {
  id: string;
  modelId: string;
  modelName: string;
  partNumber: string;
  format: string;
  fileSize: string;
  downloadedAt: string;
  status: "completed" | "expired";
  project?: string;
}

interface DownloadState {
  downloads: DownloadItem[];
  addDownload: (item: Omit<DownloadItem, "id" | "downloadedAt">) => void;
  removeDownload: (id: string) => void;
  clearExpired: () => void;
}

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set) => ({
      downloads: [],
      addDownload: (item) =>
        set((state) => ({
          downloads: [
            {
              ...item,
              id: `dl-${Date.now()}`,
              downloadedAt: new Date().toISOString(),
            },
            ...state.downloads,
          ],
        })),
      removeDownload: (id) =>
        set((state) => ({
          downloads: state.downloads.filter((d) => d.id !== id),
        })),
      clearExpired: () =>
        set((state) => ({
          downloads: state.downloads.filter((d) => d.status !== "expired"),
        })),
    }),
    { name: "downloads-storage" }
  )
);
