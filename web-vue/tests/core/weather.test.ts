import { describe, it, expect } from 'vitest';
import {
  pirepCssColor,
  pirepIntensityToBumps,
  geoLatToMercY,
  mercatorSourceRow,
  turbCropX,
  reprojectMercatorToGeo,
  filterRadarPixels,
  buildAwcUrl,
  isPirepCurrent,
  flightLevelToMeters,
  orderTurbLevels,
  isTurbulenceSigmet,
  sigmetColors,
  PIREP_MAX_AGE_MS,
  PIREP_CSS_COLORS,
} from '@/core/weather';

describe('pirepCssColor', () => {
  it('maps NEG to blue', () => {
    expect(pirepCssColor('NEG')).toBe(PIREP_CSS_COLORS.NEG);
  });
  it('maps MOD to orange', () => {
    expect(pirepCssColor('MOD')).toBe(PIREP_CSS_COLORS.MOD);
  });
  it('maps SEV to red', () => {
    expect(pirepCssColor('SEV')).toBe(PIREP_CSS_COLORS.SEV);
  });
  it('maps EXTRM to magenta', () => {
    expect(pirepCssColor('EXTRM')).toBe(PIREP_CSS_COLORS.EXTRM);
  });
  it('handles compound intensity (e.g., MOD-SEV)', () => {
    // EXTRM is checked first, then SEV, then MOD
    expect(pirepCssColor('MOD-SEV')).toBe(PIREP_CSS_COLORS.SEV);
  });
  it('defaults to LGT for null', () => {
    expect(pirepCssColor(null)).toBe(PIREP_CSS_COLORS.LGT);
  });
  it('defaults to LGT for unknown', () => {
    expect(pirepCssColor('UNKNOWN')).toBe(PIREP_CSS_COLORS.LGT);
  });
});

describe('pirepIntensityToBumps', () => {
  it('returns 0 for NEG', () => {
    expect(pirepIntensityToBumps('NEG')).toBe(0);
  });
  it('returns 1 for LGT', () => {
    expect(pirepIntensityToBumps('LGT')).toBe(1);
  });
  it('returns 2 for MOD', () => {
    expect(pirepIntensityToBumps('MOD')).toBe(2);
  });
  it('returns 3 for SEV', () => {
    expect(pirepIntensityToBumps('SEV')).toBe(3);
  });
  it('returns 4 for EXTRM', () => {
    expect(pirepIntensityToBumps('EXTRM')).toBe(4);
  });
});

describe('geoLatToMercY', () => {
  it('returns 0 at equator', () => {
    expect(geoLatToMercY(0)).toBeCloseTo(0, 5);
  });
  it('is positive in northern hemisphere', () => {
    expect(geoLatToMercY(45)).toBeGreaterThan(0);
  });
  it('is negative in southern hemisphere', () => {
    expect(geoLatToMercY(-45)).toBeLessThan(0);
  });
  it('is monotonically increasing', () => {
    const lats = [-60, -30, 0, 30, 60];
    const ys = lats.map(geoLatToMercY);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
  });
});

describe('mercatorSourceRow', () => {
  it('returns 0 for north edge', () => {
    const row = mercatorSourceRow(76.97, 1000);
    expect(row).toBeLessThanOrEqual(1); // approximately top
  });
  it('returns imageHeight-1 for south edge', () => {
    const row = mercatorSourceRow(-0.19, 1000);
    expect(row).toBeGreaterThanOrEqual(998); // approximately bottom
  });
  it('clamps to valid range', () => {
    const row = mercatorSourceRow(90, 1000); // beyond image bounds
    expect(row).toBeGreaterThanOrEqual(0);
    expect(row).toBeLessThan(1000);
  });
});

describe('turbCropX', () => {
  it('returns positive offset for typical image width', () => {
    const x = turbCropX(1000);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(1000);
  });
});

describe('reprojectMercatorToGeo', () => {
  it('produces output of same size', () => {
    const width = 4;
    const height = 4;
    const src = new Uint8ClampedArray(width * height * 4);
    // Fill with recognizable pattern
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 255; src[i + 1] = 0; src[i + 2] = 0; src[i + 3] = 255;
    }
    const out = reprojectMercatorToGeo(src, width, height);
    expect(out.length).toBe(src.length);
  });
  it('preserves row content (just rearranges rows)', () => {
    const width = 2;
    const height = 10;
    const src = new Uint8ClampedArray(width * height * 4);
    // Set each row to a unique value
    for (let row = 0; row < height; row++) {
      const offset = row * width * 4;
      for (let col = 0; col < width * 4; col++) {
        src[offset + col] = row * 25;
      }
    }
    const out = reprojectMercatorToGeo(src, width, height);
    // Each output row should contain values from some source row
    for (let row = 0; row < height; row++) {
      const offset = row * width * 4;
      const val = out[offset];
      expect(val % 25).toBe(0); // should be one of the original row values
    }
  });
});

describe('filterRadarPixels', () => {
  it('makes desaturated pixels transparent', () => {
    const data = new Uint8ClampedArray([128, 128, 128, 255]); // gray
    filterRadarPixels(data);
    expect(data[3]).toBe(0);
  });
  it('keeps saturated green pixels', () => {
    const data = new Uint8ClampedArray([0, 200, 0, 255]); // vivid green
    filterRadarPixels(data);
    expect(data[3]).toBe(255);
  });
  it('keeps saturated red pixels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    filterRadarPixels(data);
    expect(data[3]).toBe(255);
  });
  it('makes very dark pixels transparent', () => {
    const data = new Uint8ClampedArray([10, 20, 5, 255]);
    filterRadarPixels(data);
    expect(data[3]).toBe(0);
  });
  it('skips already transparent pixels', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 0]);
    filterRadarPixels(data);
    expect(data[3]).toBe(0);
  });
});

describe('buildAwcUrl', () => {
  it('builds direct URL when no proxy', () => {
    const url = buildAwcUrl('pirep?format=geojson', null);
    expect(url).toBe('https://aviationweather.gov/api/data/pirep?format=geojson');
  });
  it('builds proxied URL when proxy configured', () => {
    const url = buildAwcUrl('pirep?format=geojson&type=turb', 'awc-proxy.php');
    expect(url).toBe('awc-proxy.php?endpoint=pirep&format=geojson&type=turb');
  });
  it('handles path without query string', () => {
    const url = buildAwcUrl('sigmet', 'awc-proxy.php');
    expect(url).toBe('awc-proxy.php?endpoint=sigmet');
  });
});

describe('isPirepCurrent', () => {
  it('returns true for null timestamp', () => {
    expect(isPirepCurrent(null, Date.now())).toBe(true);
  });
  it('returns true for recent PIREP', () => {
    const now = Date.now();
    const recentTime = new Date(now - 1000).toISOString();
    expect(isPirepCurrent(recentTime, now)).toBe(true);
  });
  it('returns false for old PIREP', () => {
    const now = Date.now();
    const oldTime = new Date(now - PIREP_MAX_AGE_MS - 1000).toISOString();
    expect(isPirepCurrent(oldTime, now)).toBe(false);
  });
});

describe('flightLevelToMeters', () => {
  it('converts FL350 correctly', () => {
    const meters = flightLevelToMeters(350);
    expect(meters).toBeCloseTo(10668, 0);
  });
});

describe('orderTurbLevels', () => {
  it('puts primary level first', () => {
    const levels = orderTurbLevels('300');
    expect(levels[0]).toBe('300');
  });
  it('returns just primary for maxa', () => {
    expect(orderTurbLevels('maxa')).toEqual(['maxa']);
  });
  it('includes nearby levels as fallbacks', () => {
    const levels = orderTurbLevels('300');
    expect(levels.length).toBeGreaterThan(1);
    expect(levels.length).toBeLessThanOrEqual(5);
  });
  it('orders fallbacks by proximity', () => {
    const levels = orderTurbLevels('300');
    // 270 and 330 are adjacent and should appear before 240/360
    expect(levels).toContain('270');
    expect(levels).toContain('330');
    expect(levels.indexOf('270')).toBeLessThan(levels.indexOf('240'));
    expect(levels.indexOf('330')).toBeLessThan(levels.indexOf('240'));
  });
});

describe('isTurbulenceSigmet', () => {
  it('recognizes TURB', () => {
    expect(isTurbulenceSigmet('TURB')).toBe(true);
  });
  it('recognizes CONVECTIVE', () => {
    expect(isTurbulenceSigmet('CONVECTIVE')).toBe(true);
  });
  it('rejects ICE', () => {
    expect(isTurbulenceSigmet('ICE')).toBe(false);
  });
});

describe('sigmetColors', () => {
  it('returns red for TURB', () => {
    const colors = sigmetColors('TURB');
    expect(colors.fill[0]).toBe(1.0); // red
    expect(colors.fill[1]).toBe(0.0);
  });
  it('returns yellow for CONVECTIVE', () => {
    const colors = sigmetColors('CONVECTIVE');
    expect(colors.fill[0]).toBe(1.0);
    expect(colors.fill[1]).toBe(0.85); // yellow
  });
});
