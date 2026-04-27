import Icon from "../shared/Icon";
import type { CameraPreset } from "./ModelViewer";
import { dispatchFitModel } from "./viewerEvents";

interface ViewCubeProps {
  activeCamera: CameraPreset;
  onCameraChange: (preset: CameraPreset) => void;
  className?: string;
}

const FACE_BUTTONS: Array<{ key: CameraPreset; label: string; title: string }> = [
  { key: "front", label: "正", title: "正视图" },
  { key: "back", label: "后", title: "后视图" },
  { key: "left", label: "左", title: "左视图" },
  { key: "right", label: "右", title: "右视图" },
  { key: "top", label: "俯", title: "俯视图" },
  { key: "bottom", label: "仰", title: "仰视图" },
  { key: "iso", label: "轴", title: "等轴测" },
];

export default function ViewCube({ activeCamera, onCameraChange, className = "" }: ViewCubeProps) {
  return (
    <div
      className={`micro-glass rounded-sm p-1.5 shadow-lg ${className}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="grid grid-cols-4 gap-1">
        {FACE_BUTTONS.map((face) => (
          <button
            key={face.key}
            type="button"
            title={face.title}
            onClick={() => onCameraChange(face.key)}
            className={`h-7 w-7 rounded-sm border text-[11px] font-medium transition-colors ${
              activeCamera === face.key
                ? "border-primary/60 bg-primary-container/20 text-primary"
                : "border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant hover:border-primary/40 hover:text-primary"
            }`}
          >
            {face.label}
          </button>
        ))}
        <button
          type="button"
          title="适配视图"
          onClick={dispatchFitModel}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Icon name="locate_fixed" size={15} />
        </button>
      </div>
    </div>
  );
}
