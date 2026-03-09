import { describe, it, expect } from 'vitest';
import { boundsContain, extrapolatePosition, haversineDistance } from '@/core/geo';

describe('boundsContain', () => {
  const outer = { south: 30, north: 50, west: -100, east: -70 };

  it('returns true when inner is fully contained', () => {
    const inner = { south: 35, north: 45, west: -90, east: -80 };
    expect(boundsContain(outer, inner)).toBe(true);
  });
  it('returns false when inner extends beyond', () => {
    const inner = { south: 25, north: 45, west: -90, east: -80 };
    expect(boundsContain(outer, inner)).toBe(false);
  });
  it('returns true when inner equals outer', () => {
    expect(boundsContain(outer, { ...outer })).toBe(true);
  });
  it('returns false for null outer', () => {
    expect(boundsContain(null, outer)).toBe(false);
  });
  it('returns false for null inner', () => {
    expect(boundsContain(outer, null)).toBe(false);
  });
});

describe('extrapolatePosition', () => {
  it('moves north when heading is 0', () => {
    const result = extrapolatePosition(40, -74, 100, 0, 10);
    expect(result.lat).toBeGreaterThan(40);
    expect(result.lon).toBeCloseTo(-74, 3); // should barely change
  });
  it('moves east when heading is 90', () => {
    const result = extrapolatePosition(40, -74, 100, 90, 10);
    expect(result.lat).toBeCloseTo(40, 3);
    expect(result.lon).toBeGreaterThan(-74);
  });
  it('returns same position with zero velocity', () => {
    const result = extrapolatePosition(40, -74, 0, 90, 10);
    expect(result.lat).toBe(40);
    expect(result.lon).toBe(-74);
  });
  it('returns same position with zero time delta', () => {
    const result = extrapolatePosition(40, -74, 100, 90, 0);
    expect(result.lat).toBe(40);
    expect(result.lon).toBe(-74);
  });
});

describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    expect(haversineDistance(40, -74, 40, -74)).toBe(0);
  });
  it('approximates known distance (JFK to LAX ~3960km)', () => {
    const dist = haversineDistance(40.6413, -73.7781, 33.9416, -118.4085);
    expect(dist).toBeGreaterThan(3_900_000);
    expect(dist).toBeLessThan(4_100_000);
  });
  it('is symmetric', () => {
    const d1 = haversineDistance(40, -74, 34, -118);
    const d2 = haversineDistance(34, -118, 40, -74);
    expect(d1).toBeCloseTo(d2, 5);
  });
});
