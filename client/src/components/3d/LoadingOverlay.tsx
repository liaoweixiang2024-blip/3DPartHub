import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import Icon from "../shared/Icon";

interface LoadingOverlayProps {
  progress?: number | null;
}

export default function LoadingOverlay({ progress: externalProgress }: LoadingOverlayProps) {
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const manager = THREE.DefaultLoadingManager;

    const onStart = () => {
      setLoading(true);
      setProgress(0);
    };
    const onProgress = (_url: string, loaded: number, total: number) => {
      if (total > 0) {
        setProgress(Math.round((loaded / total) * 100));
      } else {
        setProgress((value) => Math.max(value, 35));
      }
    };
    const onLoad = () => {
      setProgress(100);
      setTimeout(() => setLoading(false), 300);
    };
    const onError = () => {
      setLoading(false);
    };

    manager.onStart = onStart;
    manager.onProgress = onProgress;
    manager.onLoad = onLoad;
    manager.onError = onError;

    return () => {
      manager.onStart = () => {};
      manager.onProgress = () => {};
      manager.onLoad = () => {};
      manager.onError = () => {};
    };
  }, []);

  const hasExternalProgress = typeof externalProgress === "number" && Number.isFinite(externalProgress) && externalProgress < 100;
  const visible = loading || hasExternalProgress;
  const displayProgress = hasExternalProgress
    ? Math.max(0, Math.min(99, Math.round(externalProgress)))
    : progress;
  const phase = useMemo(() => {
    if (displayProgress < 8) return "准备模型";
    if (displayProgress < 55) return "下载模型";
    if (displayProgress < 88) return "解析几何";
    if (displayProgress < 100) return "上传 GPU";
    return "渲染中";
  }, [displayProgress]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none bg-surface-dim/80 backdrop-blur-sm">
      <Icon name="view_in_ar" size={40} className="text-primary/40 animate-pulse mb-4" />
      <div className="w-40 h-1 bg-surface-container-highest rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
          style={{ width: `${displayProgress}%` }}
        />
      </div>
      <span className="text-xs text-on-surface-variant font-mono mt-2">
        {displayProgress < 100 ? `${phase} ${displayProgress}%` : "渲染中..."}
      </span>
    </div>
  );
}
