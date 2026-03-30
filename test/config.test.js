import { describe, it, expect } from 'vitest'

// Import defaults first (sets window.DEFAULT_SETTINGS), then config
import '../src/defaults.js'
import '../src/config.js'

// Access functions via window globals (same pattern as the app)
const {
  hexToRgb, brighten, withAlpha, lighten,
  hslToRgb, altitudeToRgb, altitudeToTrailWidth,
  getZoomFraction, computeIconSize, computeDisplaySize,
  computePollInterval, computePositionUpdateInterval,
  labelFont, CONFIG, CITY_HEIGHT, CONUS_HEIGHT,
} = globalThis

describe('hexToRgb', () => {
  it('converts white', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })

  it('converts black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })

  it('converts a color', () => {
    expect(hexToRgb('#ff8040')).toEqual([255, 128, 64])
  })
})

describe('brighten', () => {
  it('brightens a dark color', () => {
    const result = brighten('#404040', 2.0)
    expect(result).toBe('#808080')
  })

  it('clamps to 255', () => {
    const result = brighten('#ffffff', 2.0)
    expect(result).toBe('#ffffff')
  })

  it('uses default factor of 1.3', () => {
    const result = brighten('#646464')
    // 100 * 1.3 = 130 = 0x82
    expect(result).toBe('#828282')
  })
})

describe('withAlpha', () => {
  it('creates rgba string', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('handles full opacity', () => {
    expect(withAlpha('#00ff00', 1)).toBe('rgba(0, 255, 0, 1)')
  })
})

describe('lighten', () => {
  it('lightens black to gray at 50%', () => {
    const result = lighten('#000000', 0.5)
    expect(result).toBe('#808080')
  })

  it('keeps white as white', () => {
    expect(lighten('#ffffff', 0.5)).toBe('#ffffff')
  })
})

describe('hslToRgb', () => {
  it('converts red (h=0)', () => {
    const [r, g, b] = hslToRgb(0, 1.0, 0.5)
    expect(r).toBe(255)
    expect(g).toBe(0)
    expect(b).toBe(0)
  })

  it('converts green (h=120)', () => {
    const [r, g, b] = hslToRgb(120, 1.0, 0.5)
    expect(r).toBe(0)
    expect(g).toBe(255)
    expect(b).toBe(0)
  })

  it('converts blue (h=240)', () => {
    const [r, g, b] = hslToRgb(240, 1.0, 0.5)
    expect(r).toBe(0)
    expect(g).toBe(0)
    expect(b).toBe(255)
  })

  it('converts white (l=1)', () => {
    const [r, g, b] = hslToRgb(0, 0, 1.0)
    expect(r).toBe(255)
    expect(g).toBe(255)
    expect(b).toBe(255)
  })

  it('converts black (l=0)', () => {
    const [r, g, b] = hslToRgb(0, 0, 0)
    expect(r).toBe(0)
    expect(g).toBe(0)
    expect(b).toBe(0)
  })
})

describe('altitudeToRgb', () => {
  it('returns red-ish for ground level (hue ~0)', () => {
    const [r, g, b] = altitudeToRgb(0)
    // Exact values depend on theme; red channel should be highest
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('returns magenta-ish for high altitude', () => {
    // 40000 feet = 12192 meters → hue=300 → magenta
    const [r, g, b] = altitudeToRgb(12192)
    expect(r).toBeGreaterThan(g)
    expect(b).toBeGreaterThan(g)
  })

  it('clamps above 40000 feet', () => {
    const rgb40k = altitudeToRgb(12192)
    const rgb60k = altitudeToRgb(20000)
    expect(rgb40k).toEqual(rgb60k)
  })

  it('produces different colors at different altitudes', () => {
    const low = altitudeToRgb(1000)
    const high = altitudeToRgb(10000)
    expect(low).not.toEqual(high)
  })
})

describe('altitudeToTrailWidth', () => {
  it('returns ~1 at ground level', () => {
    expect(altitudeToTrailWidth(0)).toBe(1)
  })

  it('returns ~6 at FL400', () => {
    expect(altitudeToTrailWidth(12192)).toBe(6)
  })

  it('clamps above 40000 feet', () => {
    expect(altitudeToTrailWidth(20000)).toBe(6)
  })

  it('handles null', () => {
    expect(altitudeToTrailWidth(null)).toBe(1)
  })
})

describe('getZoomFraction', () => {
  it('returns 0 at city height', () => {
    expect(getZoomFraction(CITY_HEIGHT)).toBe(0)
  })

  it('returns 1 at CONUS height', () => {
    expect(getZoomFraction(CONUS_HEIGHT)).toBe(1)
  })

  it('returns 0 below city height', () => {
    expect(getZoomFraction(1000)).toBe(0)
  })

  it('returns 1 above CONUS height', () => {
    expect(getZoomFraction(10000000)).toBe(1)
  })

  it('returns value between 0 and 1 for intermediate heights', () => {
    const mid = Math.sqrt(CITY_HEIGHT * CONUS_HEIGHT) // geometric mean
    const frac = getZoomFraction(mid)
    expect(frac).toBeGreaterThan(0)
    expect(frac).toBeLessThan(1)
  })
})

describe('computeIconSize', () => {
  it('returns larger size at city zoom', () => {
    const citySize = computeIconSize(CITY_HEIGHT, 20)
    const conusSize = computeIconSize(CONUS_HEIGHT, 20)
    expect(citySize).toBeGreaterThan(conusSize)
  })

  it('never goes below MIN_SIZE (2)', () => {
    expect(computeIconSize(CONUS_HEIGHT, 1)).toBeGreaterThanOrEqual(2)
  })
})

describe('computeDisplaySize', () => {
  it('returns larger at city zoom', () => {
    expect(computeDisplaySize(CITY_HEIGHT)).toBeGreaterThan(computeDisplaySize(CONUS_HEIGHT))
  })
})

describe('computePollInterval', () => {
  it('returns 10s at city zoom', () => {
    expect(computePollInterval(CITY_HEIGHT)).toBe(10000)
  })

  it('returns 60s at CONUS zoom', () => {
    expect(computePollInterval(CONUS_HEIGHT)).toBe(60000)
  })
})

describe('computePositionUpdateInterval', () => {
  it('returns 200ms at city zoom', () => {
    expect(computePositionUpdateInterval(CITY_HEIGHT)).toBe(200)
  })

  it('returns 3000ms at CONUS zoom', () => {
    expect(computePositionUpdateInterval(CONUS_HEIGHT)).toBe(3000)
  })
})

describe('labelFont', () => {
  it('generates font string with defaults', () => {
    expect(labelFont(12)).toBe('500 12px JetBrains Mono, monospace')
  })

  it('accepts custom weight', () => {
    expect(labelFont(14, 700)).toBe('700 14px JetBrains Mono, monospace')
  })
})

describe('CONFIG', () => {
  it('is defined with expected defaults', () => {
    expect(CONFIG).toBeDefined()
    expect(CONFIG.startLon).toBe(-98.6)
    expect(CONFIG.startLat).toBe(39.8)
    expect(CONFIG.pollInterval).toBe(15000)
  })
})
