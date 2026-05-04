/**
 * Color scheme engine — applies CSS custom properties dynamically.
 */
import { COLOR_PRESETS, COLOR_KEYS, type ColorKey } from './colorSchemes';

const STYLE_ID = 'dynamic-theme';

/**
 * Apply a color scheme by injecting a <style> tag that overrides CSS variables.
 */
export function applyColorScheme(scheme: string, customDark: string, customLight: string): void {
  let darkVars: Record<string, string> | undefined;
  let lightVars: Record<string, string> | undefined;

  if (scheme && scheme !== 'custom' && COLOR_PRESETS[scheme]) {
    const preset = COLOR_PRESETS[scheme];
    darkVars = preset.dark;
    lightVars = preset.light;
  } else if (scheme === 'custom') {
    try {
      darkVars = JSON.parse(customDark || '{}');
    } catch {
      darkVars = {};
    }
    try {
      lightVars = JSON.parse(customLight || '{}');
    } catch {
      lightVars = {};
    }
  }

  if (!darkVars || !lightVars) return;
  // Skip if both are empty (no customization)
  if (Object.keys(darkVars).length === 0 && Object.keys(lightVars).length === 0) {
    removeColorScheme();
    return;
  }

  let css = '';
  if (Object.keys(darkVars).length > 0) {
    css += ':root {\n';
    for (const [key, value] of Object.entries(darkVars)) {
      css += `  --color-${key}: ${value};\n`;
    }
    css += '}\n';
  }
  if (Object.keys(lightVars).length > 0) {
    css += '.theme-light {\n';
    for (const [key, value] of Object.entries(lightVars)) {
      css += `  --color-${key}: ${value};\n`;
    }
    css += '}\n';
  }

  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

/**
 * Remove dynamic theme overrides, reverting to defaults from global.css.
 */
export function removeColorScheme(): void {
  const tag = document.getElementById(STYLE_ID);
  if (tag) tag.remove();
}

// --- HSL utilities ---

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// --- Palette generation from a single primary color ---

/**
 * Generate a complete color palette from a primary hex color.
 * Uses tonal palette approach inspired by Material Design 3.
 */
export function generatePaletteFromPrimary(primaryHex: string): {
  dark: Record<string, string>;
  light: Record<string, string>;
} {
  const { h, s } = hexToHsl(primaryHex);

  // Helper: create a color at a specific tone (lightness)
  const tone = (l: number, satMul = 1, hueShift = 0) => hslToHex((h + hueShift + 360) % 360, Math.round(s * satMul), l);

  const dark: Record<string, string> = {
    primary: tone(75, 0.7), // lighter for dark bg
    'primary-container': primaryHex,
    'on-primary': tone(15, 0.8), // dark text on primary
    'on-primary-container': tone(20, 0.8),
    secondary: tone(65, 0.4, 30), // hue-shifted, muted
    'secondary-container': tone(30, 0.3, 30),
    'on-secondary': tone(20, 0.3, 30),
    'on-secondary-container': tone(60, 0.35, 30),
    tertiary: tone(70, 0.5, -40), // opposite hue shift
    'tertiary-container': tone(45, 0.7, -40),
    'on-tertiary': tone(15, 0.4, -40),
    'on-tertiary-container': tone(15, 0.4, -40),
    error: '#ffb4ab',
    'error-container': '#93000a',
    outline: tone(55, 0.3), // desaturated primary
    'outline-variant': tone(30, 0.2),
    'on-surface-variant': tone(70, 0.35),
  };

  const light: Record<string, string> = {
    primary: tone(35, 0.8), // darker for light bg
    'primary-container': primaryHex,
    'on-primary': '#ffffff',
    'on-primary-container': tone(12, 0.7),
    secondary: tone(38, 0.45, 30),
    'secondary-container': tone(88, 0.3, 30),
    'on-secondary': tone(15, 0.3, 30),
    'on-secondary-container': tone(15, 0.3, 30),
    tertiary: tone(38, 0.6, -40),
    'tertiary-container': tone(88, 0.3, -40),
    'on-tertiary': tone(15, 0.4, -40),
    'on-tertiary-container': tone(15, 0.4, -40),
    error: '#ba1a1a',
    'error-container': '#ffdad6',
    outline: tone(42, 0.25),
    'outline-variant': tone(75, 0.2),
    'on-surface-variant': tone(32, 0.25),
  };

  return { dark, light };
}

export { COLOR_KEYS, type ColorKey };
