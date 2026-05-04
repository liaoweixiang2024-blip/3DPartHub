import Icon from '../shared/Icon';
import { VIEWER_TUNING_FIELDS, VIEWER_TUNING_PRESETS, type ViewerTuning } from './viewerTuning';

interface ViewerTuningPanelProps {
  value: ViewerTuning;
  onChange: (next: ViewerTuning) => void;
  onPreset: (next: ViewerTuning) => void;
  onReset: () => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}

export default function ViewerTuningPanel({
  value,
  onChange,
  onPreset,
  onReset,
  onSave,
  onClose,
  saving,
}: ViewerTuningPanelProps) {
  const update = (key: keyof ViewerTuning, nextValue: string | number) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="micro-glass rounded-md border border-outline-variant/20 shadow-xl w-full max-w-[340px] max-h-[calc(100dvh-9rem)] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/15">
        <div className="flex items-center gap-2">
          <Icon name="tune" size={16} className="text-primary" />
          <span className="text-xs font-semibold text-on-surface">3D 预览调试</span>
        </div>
        <button onClick={onClose} className="p-1 text-on-surface-variant hover:text-on-surface">
          <Icon name="close" size={15} />
        </button>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto scrollbar-hidden">
        <div className="grid grid-cols-3 gap-1">
          {VIEWER_TUNING_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => onPreset(preset.value)}
              className="rounded-sm border border-outline-variant/20 bg-surface-container-high/50 px-2 py-1.5 text-[10px] text-on-surface-variant hover:border-primary/40 hover:text-primary"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
          <label className="text-[10px] text-on-surface-variant">背景</label>
          <input
            value={value.viewer_bg_color}
            onChange={(event) => update('viewer_bg_color', event.target.value)}
            className="w-44 min-w-0 rounded-sm border border-outline-variant/20 bg-surface-container-lowest px-2 py-1 text-[10px] text-on-surface outline-none focus:border-primary"
          />
          <label className="text-[10px] text-on-surface-variant">材质色</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={value.mat_default_color}
              onChange={(event) => update('mat_default_color', event.target.value)}
              className="h-7 w-9 rounded border border-outline-variant/20 bg-transparent"
            />
            <span className="w-20 text-[10px] font-mono text-on-surface-variant">{value.mat_default_color}</span>
          </div>
        </div>

        <div className="space-y-2">
          {VIEWER_TUNING_FIELDS.map((field) => (
            <div key={field.key} className="grid grid-cols-[52px_1fr_38px] items-center gap-2">
              <label className="text-[10px] text-on-surface-variant">{field.label}</label>
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={Number(value[field.key])}
                onChange={(event) => update(field.key, Number(event.target.value))}
                className="w-full accent-primary-container"
              />
              <span className="text-right text-[10px] font-mono text-on-surface-variant">
                {Number(value[field.key]).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/15">
          <button onClick={onReset} className="px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-on-surface">
            还原
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-sm bg-primary-container px-3 py-1.5 text-xs font-medium text-on-primary hover:bg-primary disabled:opacity-50"
          >
            <Icon name="save" size={13} />
            {saving ? '保存中' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
