/**
 * Shared color conversion utilities.
 * Single source of truth for HSL ↔ Hex conversions used by the theme system.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = (((hue % 360) + 360) % 360) / 30;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = s * Math.min(l, 1 - l);

  const channel = (offset: number) => {
    const k = (offset + h) % 12;
    const color = l - chroma * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * clamp(color, 0, 1))
      .toString(16)
      .padStart(2, '0');
  };

  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
