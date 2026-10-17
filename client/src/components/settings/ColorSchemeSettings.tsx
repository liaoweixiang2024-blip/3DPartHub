import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemSettings } from '../../api/settings';
import { applyColorScheme, generatePaletteFromPrimary } from '../../lib/colorScheme';
import { COLOR_KEYS, COLOR_PRESETS } from '../../lib/colorSchemes';
import Icon from '../shared/Icon';

type ColorSchemeSettingsProps = {
  settings: SystemSettings;
  updateSetting: (key: keyof SystemSettings, value: boolean | number | string) => void;
};

// label 存 settingsWidgets i18n 键，渲染处 t()
const COLOR_KEY_GROUPS = [
  {
    label: 'settingsWidgets.colorGroupSurface',
    keys: [
      'surface-tint',
      'surface',
      'surface-dim',
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
      'surface-container-highest',
      'surface-bright',
      'surface-variant',
      'on-surface',
      'on-background',
      'on-surface-variant',
    ],
  },
  {
    label: 'settingsWidgets.colorGroupPrimary',
    keys: ['primary', 'primary-container', 'on-primary', 'on-primary-container'],
  },
  {
    label: 'settingsWidgets.colorGroupSecondary',
    keys: ['secondary', 'secondary-container', 'on-secondary', 'on-secondary-container'],
  },
  {
    label: 'settingsWidgets.colorGroupTertiary',
    keys: ['tertiary', 'tertiary-container', 'on-tertiary', 'on-tertiary-container'],
  },
  {
    label: 'settingsWidgets.colorGroupState',
    keys: ['error', 'error-container', 'outline', 'outline-variant'],
  },
] satisfies { label: string; keys: (typeof COLOR_KEYS)[number][] }[];

export default function ColorSchemeSettings({ settings, updateSetting }: ColorSchemeSettingsProps) {
  const { t } = useTranslation();
  const [customMode, setCustomMode] = useState<'generate' | 'advanced'>('generate');
  const [customPrimary, setCustomPrimary] = useState('#3b82f6');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const currentScheme = (settings.color_scheme as string) || 'orange';
  const isCustom = currentScheme === 'custom';

  let customDark: Record<string, string> = {};
  let customLight: Record<string, string> = {};
  try {
    customDark = JSON.parse((settings.color_custom_dark as string) || '{}');
  } catch {
    // Invalid custom color JSON falls back to an empty dark palette.
  }
  try {
    customLight = JSON.parse((settings.color_custom_light as string) || '{}');
  } catch {
    // Invalid custom color JSON falls back to an empty light palette.
  }

  const preview = useCallback(() => {
    applyColorScheme(currentScheme, settings.color_custom_dark as string, settings.color_custom_light as string);
  }, [currentScheme, settings.color_custom_dark, settings.color_custom_light]);

  useEffect(() => {
    preview();
  }, [preview]);

  function selectPreset(key: string) {
    updateSetting('color_scheme', key);
  }

  function handleGenerate() {
    const palette = generatePaletteFromPrimary(customPrimary);
    updateSetting('color_scheme', 'custom');
    updateSetting('color_custom_dark', JSON.stringify(palette.dark));
    updateSetting('color_custom_light', JSON.stringify(palette.light));
  }

  function updateCustomColor(mode: 'dark' | 'light', key: string, value: string) {
    const current = mode === 'dark' ? { ...customDark } : { ...customLight };
    current[key] = value;
    updateSetting(mode === 'dark' ? 'color_custom_dark' : 'color_custom_light', JSON.stringify(current));
    if (currentScheme !== 'custom') {
      updateSetting('color_scheme', 'custom');
    }
  }

  return (
    <>
      <div>
        <p className="text-sm font-medium text-on-surface mb-1">{t('settingsWidgets.colorScheme')}</p>
        <p className="text-xs text-on-surface-variant mb-3">{t('settingsWidgets.colorSchemeDesc')}</p>

        <div className="flex flex-wrap gap-3">
          {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => selectPreset(key)}
              className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border-2 transition-all ${
                currentScheme === key
                  ? 'border-primary-container bg-primary-container/10 shadow-sm'
                  : 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30'
              }`}
            >
              <span
                className="w-8 h-8 rounded-full shadow-inner border border-white/10"
                style={{ backgroundColor: preset.primary }}
              />
              <span className="text-[10px] text-on-surface-variant font-medium">
                {t(preset.label, { defaultValue: preset.label })}
              </span>
            </button>
          ))}
          <button
            onClick={() => selectPreset('custom')}
            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border-2 transition-all ${
              isCustom
                ? 'border-primary-container bg-primary-container/10 shadow-sm'
                : 'border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30'
            }`}
          >
            <span className="w-8 h-8 rounded-full border-2 border-dashed border-on-surface-variant/40 flex items-center justify-center">
              <Icon name="colorize" size={14} className="text-on-surface-variant/60" />
            </span>
            <span className="text-[10px] text-on-surface-variant font-medium">{t('settingsWidgets.customOption')}</span>
          </button>
        </div>
      </div>

      {isCustom && (
        <div className="bg-surface-container-high/30 rounded-lg border border-outline-variant/10 p-4 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => setCustomMode('generate')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                customMode === 'generate'
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-surface-container-highest/50 text-on-surface-variant'
              }`}
            >
              {t('settingsWidgets.generateFromPrimary')}
            </button>
            <button
              onClick={() => setCustomMode('advanced')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                customMode === 'advanced'
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-surface-container-highest/50 text-on-surface-variant'
              }`}
            >
              {t('settingsWidgets.advancedCustom')}
            </button>
          </div>

          {customMode === 'generate' ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant">{t('settingsWidgets.primaryHue')}</span>
                <input
                  name="custom-primary"
                  type="color"
                  value={customPrimary}
                  onChange={(event) => setCustomPrimary(event.target.value)}
                  className="w-10 h-8 rounded cursor-pointer border border-outline-variant/30 p-0"
                />
                <span className="text-xs text-on-surface-variant font-mono">{customPrimary}</span>
              </div>
              <button
                onClick={handleGenerate}
                className="px-4 py-1.5 text-xs font-medium bg-primary-container/20 text-primary-container rounded-md hover:bg-primary-container/30 transition-colors"
              >
                {t('settingsWidgets.generatePalette')}
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1.5 text-xs text-primary-container hover:underline"
              >
                <Icon name={showAdvanced ? 'expand_less' : 'expand_more'} size={14} />
                {showAdvanced ? t('settingsWidgets.collapseColorEditor') : t('settingsWidgets.expandColorEditor')}
              </button>
              {showAdvanced && (
                <div className="space-y-3">
                  <p className="text-xs text-on-surface-variant">{t('settingsWidgets.advancedEditorDesc')}</p>
                  {(['dark', 'light'] as const).map((mode) => (
                    <div key={mode}>
                      <p className="text-xs font-medium text-on-surface mb-2">
                        {mode === 'dark' ? t('settingsWidgets.darkMode') : t('settingsWidgets.lightMode')}
                      </p>
                      <div className="space-y-2">
                        {COLOR_KEY_GROUPS.map((group, groupIndex) => (
                          <details
                            key={`${mode}-${group.label}`}
                            open={groupIndex < 2}
                            className="rounded-md border border-outline-variant/10 bg-surface-container-lowest/60 px-3 py-2"
                          >
                            <summary className="cursor-pointer select-none text-[11px] font-semibold text-on-surface">
                              {t(group.label, { defaultValue: group.label })}
                            </summary>
                            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                              {group.keys.map((colorKey) => {
                                const value = (mode === 'dark' ? customDark : customLight)[colorKey] || '';
                                return (
                                  <div key={colorKey} className="flex min-w-0 items-center gap-1.5">
                                    <input
                                      name="value"
                                      type="color"
                                      value={value || '#888888'}
                                      onChange={(event) => updateCustomColor(mode, colorKey, event.target.value)}
                                      className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 p-0"
                                    />
                                    <span className="w-28 shrink-0 truncate text-[10px] text-on-surface-variant">
                                      {colorKey}
                                    </span>
                                    <input
                                      name="value"
                                      type="text"
                                      value={value}
                                      onChange={(event) => updateCustomColor(mode, colorKey, event.target.value)}
                                      placeholder={t('settingsWidgets.defaultPlaceholder')}
                                      className="min-w-0 flex-1 rounded border border-outline-variant/15 bg-surface-container-lowest px-1.5 py-0.5 font-mono text-[10px] text-on-surface outline-none focus:border-primary"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
