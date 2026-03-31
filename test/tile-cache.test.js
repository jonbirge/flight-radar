import { describe, it, expect, beforeEach } from 'vitest'

// tileUrl is defined in radar-core.js but depends on Cesium + viewer.
// Re-implement its logic here for isolated testing.
function tileUrl(url, hasFlightAPI) {
  if (hasFlightAPI) return url.replace(/^https:\/\//, 'tile://');
  return url;
}

describe('tileUrl', () => {
  it('replaces https:// with tile:// when flightAPI is available', () => {
    const url = 'https://a.basemaps.cartocdn.com/dark_all/5/10/12.png';
    expect(tileUrl(url, true)).toBe('tile://a.basemaps.cartocdn.com/dark_all/5/10/12.png');
  });

  it('preserves template variables in the URL', () => {
    const url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    expect(tileUrl(url, true)).toBe('tile://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png');
  });

  it('returns original URL unchanged when flightAPI is not available', () => {
    const url = 'https://a.basemaps.cartocdn.com/dark_all/5/10/12.png';
    expect(tileUrl(url, false)).toBe(url);
  });

  it('handles Esri tile URLs', () => {
    const url = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
    expect(tileUrl(url, true)).toBe('tile://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}');
  });

  it('handles OpenTopoMap URLs with subdomains', () => {
    const url = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
    expect(tileUrl(url, true)).toBe('tile://{s}.tile.opentopomap.org/{z}/{x}/{y}.png');
  });

  it('handles VFR map tile URLs', () => {
    const url = 'https://vfrmap.com/20251225/tiles/vfrc/{z}/{reverseY}/{x}.jpg';
    expect(tileUrl(url, true)).toBe('tile://vfrmap.com/20251225/tiles/vfrc/{z}/{reverseY}/{x}.jpg');
  });
});

describe('tile cache path generation', () => {
  // Re-implement tileCachePath logic for testing (from main.js)
  function tileCachePath(url, cacheDir) {
    const parsed = new URL(url);
    const safePath = (parsed.host + parsed.pathname).replace(/\.\./g, '');
    return cacheDir + '/' + safePath;
  }

  it('generates path from host and pathname', () => {
    const result = tileCachePath('https://a.basemaps.cartocdn.com/dark_all/5/10/12.png', '/cache');
    expect(result).toBe('/cache/a.basemaps.cartocdn.com/dark_all/5/10/12.png');
  });

  it('handles Esri tile URL structure', () => {
    const result = tileCachePath('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/12', '/cache');
    expect(result).toBe('/cache/services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/12');
  });

  it('strips directory traversal sequences', () => {
    const result = tileCachePath('https://evil.com/../../../etc/passwd', '/cache');
    expect(result).not.toContain('..');
  });

  it('handles OpenStreetMap tile URLs', () => {
    const result = tileCachePath('https://a.tile.openstreetmap.org/5/10/12.png', '/cache');
    expect(result).toBe('/cache/a.tile.openstreetmap.org/5/10/12.png');
  });
});

describe('tile protocol URL reconstruction', () => {
  it('converts tile:// back to https://', () => {
    const tileUrl = 'tile://a.basemaps.cartocdn.com/dark_all/5/10/12.png';
    const original = tileUrl.replace(/^tile:\/\//, 'https://');
    expect(original).toBe('https://a.basemaps.cartocdn.com/dark_all/5/10/12.png');
  });

  it('round-trips correctly', () => {
    const original = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/10/12';
    const cached = original.replace(/^https:\/\//, 'tile://');
    const restored = cached.replace(/^tile:\/\//, 'https://');
    expect(restored).toBe(original);
  });
});
