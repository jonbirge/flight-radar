import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  brighten,
  withAlpha,
  lighten,
  hslToRgb,
  altitudeToRgb,
  altitudeToSelectedRgb,
  altitudeToTrailWidth,
  deriveDarkColors,
  deriveLightColors,
} from '@/core/colors';

describe('hexToRgb', () => {
  it('parses white', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
  });
  it('parses black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
  });
  it('parses arbitrary color', () => {
    expect(hexToRgb('#cc8844')).toEqual([204, 136, 68]);
  });
});

describe('brighten', () => {
  it('brightens a color by default factor 1.3', () => {
    const result = brighten('#646464');
    const [r, g, b] = hexToRgb(result);
    expect(r).toBe(Math.min(255, Math.round(100 * 1.3)));
    expect(g).toBe(Math.min(255, Math.round(100 * 1.3)));
    expect(b).toBe(Math.min(255, Math.round(100 * 1.3)));
  });
  it('clamps to 255', () => {
    const result = brighten('#ffffff', 2.0);
    expect(hexToRgb(result)).toEqual([255, 255, 255]);
  });
});

describe('withAlpha', () => {
  it('returns rgba string', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });
});

describe('lighten', () => {
  it('lightens toward white', () => {
    const result = lighten('#000000', 0.5);
    expect(hexToRgb(result)).toEqual([128, 128, 128]);
  });
  it('pure white stays white', () => {
    expect(lighten('#ffffff', 0.5)).toBe('#ffffff');
  });
});

describe('hslToRgb', () => {
  it('converts pure red', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0]);
  });
  it('converts pure green', () => {
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0]);
  });
  it('converts pure blue', () => {
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255]);
  });
  it('converts gray (zero saturation)', () => {
    const [r, g, b] = hslToRgb(0, 0, 0.5);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBe(128);
  });
});

describe('altitudeToRgb', () => {
  it('returns red-ish at ground level in dark mode', () => {
    const [r, g, b] = altitudeToRgb(0, 'dark');
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
  it('returns different color at FL350 vs ground', () => {
    const ground = altitudeToRgb(0, 'dark');
    const fl350 = altitudeToRgb(10668, 'dark'); // ~35000 feet
    expect(ground).not.toEqual(fl350);
  });
  it('handles null altitude', () => {
    const rgb = altitudeToRgb(null, 'dark');
    expect(rgb).toEqual([255, 0, 0]); // 0 feet = ground = red
  });
  it('light mode produces more muted colors', () => {
    const dark = altitudeToRgb(5000, 'dark');
    const light = altitudeToRgb(5000, 'light');
    // Light mode uses lower saturation and lightness
    expect(dark).not.toEqual(light);
  });
});

describe('altitudeToSelectedRgb', () => {
  it('dark mode lightens the color', () => {
    const base = altitudeToRgb(5000, 'dark');
    const sel = altitudeToSelectedRgb(5000, 'dark');
    // Selected should be lighter (closer to white) in dark mode
    expect(sel[0]).toBeGreaterThanOrEqual(base[0]);
  });
  it('light mode darkens the color', () => {
    const base = altitudeToRgb(5000, 'light');
    const sel = altitudeToSelectedRgb(5000, 'light');
    // Selected should be darker in light mode
    expect(sel[0]).toBeLessThanOrEqual(base[0]);
  });
});

describe('altitudeToTrailWidth', () => {
  it('returns 1 at ground level', () => {
    expect(altitudeToTrailWidth(0)).toBe(1);
  });
  it('returns 6 at FL400', () => {
    expect(altitudeToTrailWidth(12192)).toBe(6); // 40000 feet in meters
  });
  it('clamps above FL400', () => {
    expect(altitudeToTrailWidth(20000)).toBe(6); // well above FL400
  });
  it('handles null', () => {
    expect(altitudeToTrailWidth(null)).toBe(1);
  });
});

describe('deriveDarkColors', () => {
  it('returns all required color properties', () => {
    const colors = deriveDarkColors('#cccccc');
    expect(colors.phosphor).toBe('#cccccc');
    expect(colors.phosphorBright).toBeTruthy();
    expect(colors.phosphorSelect).toBeTruthy();
    expect(colors.phosphorDim).toContain('rgba');
    expect(colors.trailColor).toEqual([204, 204, 204]);
    expect(colors.labelOutlineMode).toBe('dark');
  });
});

describe('deriveLightColors', () => {
  it('returns all required color properties', () => {
    const colors = deriveLightColors('#1a1a1a');
    expect(colors.phosphor).toBe('#1a1a1a');
    expect(colors.labelOutlineMode).toBe('light');
  });
  it('handles empty string with fallback', () => {
    const colors = deriveLightColors('');
    expect(colors.phosphor).toBe('#1a1a1a');
  });
});
