import { describe, it, expect } from 'vitest';
import {
  formatAltitude,
  formatSpeed,
  verticalIndicator,
  formatDuration,
  metersToFeet,
  msToKnots,
} from '@/core/formatting';

describe('formatAltitude', () => {
  it('returns "---" for null', () => {
    expect(formatAltitude(null)).toBe('---');
  });
  it('returns flight level above 18000 feet', () => {
    // 18000 feet = 5486.4 meters
    expect(formatAltitude(5500)).toBe('FL180');
  });
  it('returns hundreds of feet below 18000', () => {
    // 3048 meters = 10000 feet
    expect(formatAltitude(3048)).toBe('100');
  });
  it('returns FL350 for ~35000 feet', () => {
    expect(formatAltitude(10668)).toBe('FL350');
  });
  it('handles ground level', () => {
    expect(formatAltitude(0)).toBe('0');
  });
});

describe('formatSpeed', () => {
  it('returns "---" for null', () => {
    expect(formatSpeed(null)).toBe('---');
  });
  it('converts m/s to knots', () => {
    // 100 m/s ≈ 194 knots
    expect(formatSpeed(100)).toBe('194');
  });
  it('handles zero', () => {
    expect(formatSpeed(0)).toBe('0');
  });
});

describe('verticalIndicator', () => {
  it('returns ↑ for positive rate', () => {
    expect(verticalIndicator(5.0)).toBe('↑');
  });
  it('returns ↓ for negative rate', () => {
    expect(verticalIndicator(-3.0)).toBe('↓');
  });
  it('returns space for near-zero rate', () => {
    expect(verticalIndicator(0.3)).toBe(' ');
  });
  it('returns space for null', () => {
    expect(verticalIndicator(null)).toBe(' ');
  });
  it('returns space for exactly zero', () => {
    expect(verticalIndicator(0)).toBe(' ');
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(7200)).toBe('2h 00m');
    expect(formatDuration(3661)).toBe('1h 01m');
  });
  it('formats minutes and seconds under 1 hour', () => {
    expect(formatDuration(90)).toBe('1m 30s');
  });
  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0m 00s');
  });
  it('handles negative (clamps to 0)', () => {
    expect(formatDuration(-10)).toBe('0m 00s');
  });
});

describe('metersToFeet', () => {
  it('converts correctly', () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 3);
  });
});

describe('msToKnots', () => {
  it('converts correctly', () => {
    expect(msToKnots(1)).toBeCloseTo(1.94384, 3);
  });
});
