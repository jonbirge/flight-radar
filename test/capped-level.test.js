import { describe, it, expect, vi } from 'vitest'

// The CappedLevelImageryProvider is internal to radar-core.js which depends
// heavily on Cesium.  We replicate the pure coordinate-math logic here so
// it can be unit-tested without loading the full module.

function parentCoords(x, y, level, cap) {
  const diff = level - cap;
  const scale = 1 << diff;
  const parentX = x >>> diff;
  const parentY = y >>> diff;
  const subX = x - parentX * scale;
  const subY = y - parentY * scale;
  return { parentX, parentY, subX, subY, scale };
}

function sourceRect(subX, subY, tileSize, scale) {
  const subW = tileSize / scale;
  const subH = tileSize / scale;
  return { sx: subX * subW, sy: subY * subH, sw: subW, sh: subH };
}

describe('CappedLevelImageryProvider coordinate math', () => {
  it('returns same coords when level equals cap', () => {
    // At the cap level, tiles pass through unmodified
    const { parentX, parentY, subX, subY, scale } = parentCoords(100, 200, 12, 12);
    expect(parentX).toBe(100);
    expect(parentY).toBe(200);
    expect(subX).toBe(0);
    expect(subY).toBe(0);
    expect(scale).toBe(1);
  });

  it('computes correct parent at one level above cap', () => {
    // level 13, cap 12 → each level-12 tile covers 2×2 level-13 tiles
    const { parentX, parentY, subX, subY, scale } = parentCoords(201, 401, 13, 12);
    expect(scale).toBe(2);
    expect(parentX).toBe(100);   // floor(201/2) = 100
    expect(parentY).toBe(200);   // floor(401/2) = 200
    expect(subX).toBe(1);        // 201 - 100*2 = 1
    expect(subY).toBe(1);        // 401 - 200*2 = 1
  });

  it('computes correct parent two levels above cap', () => {
    // level 14, cap 12 → each level-12 tile covers 4×4 level-14 tiles
    const { parentX, parentY, subX, subY, scale } = parentCoords(402, 803, 14, 12);
    expect(scale).toBe(4);
    expect(parentX).toBe(100);   // floor(402/4) = 100
    expect(parentY).toBe(200);   // floor(803/4) = 200
    expect(subX).toBe(2);        // 402 - 100*4 = 2
    expect(subY).toBe(3);        // 803 - 200*4 = 3
  });

  it('handles top-left sub-tile (0,0)', () => {
    const { subX, subY } = parentCoords(200, 400, 13, 12);
    expect(subX).toBe(0);
    expect(subY).toBe(0);
  });

  it('source rect covers correct quadrant', () => {
    // 256×256 tile, scale 4 → each sub-tile is 64×64
    const r = sourceRect(2, 3, 256, 4);
    expect(r.sx).toBe(128);   // 2 * 64
    expect(r.sy).toBe(192);   // 3 * 64
    expect(r.sw).toBe(64);
    expect(r.sh).toBe(64);
  });

  it('source rect covers full tile when scale is 1', () => {
    const r = sourceRect(0, 0, 256, 1);
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(256);
    expect(r.sh).toBe(256);
  });

  it('works with IFR High cap (10)', () => {
    // level 13, cap 10 → scale 8
    const { parentX, parentY, subX, subY, scale } = parentCoords(820, 1640, 13, 10);
    expect(scale).toBe(8);
    expect(parentX).toBe(102);   // floor(820/8) = 102
    expect(parentY).toBe(205);   // floor(1640/8) = 205
    expect(subX).toBe(4);        // 820 - 102*8 = 4
    expect(subY).toBe(0);        // 1640 - 205*8 = 0
  });
});
