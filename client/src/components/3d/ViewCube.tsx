import { useTranslation } from 'react-i18next';
import Icon from '../shared/Icon';
import type { CameraPreset } from './ModelViewer';
import { dispatchFitModel } from './viewerEvents';

interface ViewCubeProps {
  activeCamera: CameraPreset;
  onCameraChange: (preset: CameraPreset) => void;
  className?: string;
}

const FACE_BUTTONS: Array<{ key: CameraPreset; labelKey: string; titleKey: string }> = [
  { key: 'front', labelKey: 'viewer.viewCube.frontLabel', titleKey: 'viewer.viewCube.frontTitle' },
  { key: 'back', labelKey: 'viewer.viewCube.backLabel', titleKey: 'viewer.viewCube.backTitle' },
  { key: 'left', labelKey: 'viewer.viewCube.leftLabel', titleKey: 'viewer.viewCube.leftTitle' },
  { key: 'right', labelKey: 'viewer.viewCube.rightLabel', titleKey: 'viewer.viewCube.rightTitle' },
  { key: 'top', labelKey: 'viewer.viewCube.topLabel', titleKey: 'viewer.viewCube.topTitle' },
  { key: 'bottom', labelKey: 'viewer.viewCube.bottomLabel', titleKey: 'viewer.viewCube.bottomTitle' },
  { key: 'iso', labelKey: 'viewer.viewCube.isoLabel', titleKey: 'viewer.viewCube.isoTitle' },
];

export default function ViewCube({ activeCamera, onCameraChange, className = '' }: ViewCubeProps) {
  const { t } = useTranslation();
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
            title={t(face.titleKey)}
            onClick={() => onCameraChange(face.key)}
            className={`h-7 w-7 rounded-sm border text-[11px] font-medium transition-colors ${
              activeCamera === face.key
                ? 'border-primary/60 bg-primary-container/20 text-primary'
                : 'border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant hover:border-primary/40 hover:text-primary'
            }`}
          >
            {t(face.labelKey)}
          </button>
        ))}
        <button
          type="button"
          title={t('viewer.camera.fit')}
          onClick={dispatchFitModel}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-outline-variant/30 bg-surface-container-high/60 text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Icon name="locate_fixed" size={15} />
        </button>
      </div>
    </div>
  );
}
