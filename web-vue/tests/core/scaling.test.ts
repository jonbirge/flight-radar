import { describe, it, expect } from 'vitest';
import {
  CITY_HEIGHT,
  CONUS_HEIGHT,
  getZoomFraction,
  computeIconSize,
  computeDisplaySize,
  computePollInterval,
  computePositionUpdateInterval,
} from '@/core/scaling';

describe('getZoomFraction', () => {
  it('returns 0 at city zoom', () => {
    expect(getZoomFraction(CITY_HEIGHT)).toBe(0);
  });
  it('returns 0 below city zoom', () => {
    expect(getZoomFraction(1000)).toBe(0);
  });
  it('returns 1 at CONUS zoom', () => {
    expect(getZoomFraction(CONUS_HEIGHT)).toBe(1);
  });
  it('returns 1 above CONUS zoom', () => {
    expect(getZoomFraction(10_000_000)).toBe(1);
  });
  it('returns value between 0 and 1 for intermediate heights', () => {
    const t = getZoomFraction(1_000_000);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });
  it('is monotonically increasing', () => {
    const heights = [200_000, 500_000, 1_000_000, 3_000_000, 5_000_000];
    const fractions = heights.map(getZoomFraction);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
  });
});

describe('computeIconSize', () => {
  it('returns baseSize + 1 at city zoom', () => {
    expect(computeIconSize(CITY_HEIGHT, 10)).toBe(11);
  });
  it('returns small value at CONUS zoom', () => {
    const size = computeIconSize(CONUS_HEIGHT, 10);
    expect(size).toBeLessThanOrEqual(4);
    expect(size).toBeGreaterThanOrEqual(2);
  });
  it('never returns less than 2', () => {
    expect(computeIconSize(CONUS_HEIGHT, 1)).toBeGreaterThanOrEqual(2);
  });
});

describe('computeDisplaySize', () => {
  it('returns 10 at city zoom', () => {
    expect(computeDisplaySize(CITY_HEIGHT)).toBe(10);
  });
  it('returns 2 at CONUS zoom', () => {
    expect(computeDisplaySize(CONUS_HEIGHT)).toBe(2);
  });
});

describe('computePollInterval', () => {
  it('returns 10s at city zoom', () => {
    expect(computePollInterval(CITY_HEIGHT)).toBe(10_000);
  });
  it('returns 60s at CONUS zoom', () => {
    expect(computePollInterval(CONUS_HEIGHT)).toBe(60_000);
  });
  it('returns intermediate values', () => {
    const interval = computePollInterval(1_000_000);
    expect(interval).toBeGreaterThanOrEqual(10_000);
    expect(interval).toBeLessThanOrEqual(60_000);
  });
});

describe('computePositionUpdateInterval', () => {
  it('returns 200ms at city zoom', () => {
    expect(computePositionUpdateInterval(CITY_HEIGHT)).toBe(200);
  });
  it('returns 3000ms at CONUS zoom', () => {
    expect(computePositionUpdateInterval(CONUS_HEIGHT)).toBe(3000);
  });
});
