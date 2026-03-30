// Test setup — mock browser globals and Cesium before importing source modules

import { vi } from 'vitest'

// Mock Cesium (only the parts used during module load in config.js)
globalThis.Cesium = {
  Color: {
    BLACK: { red: 0, green: 0, blue: 0, alpha: 1 },
    WHITE: { red: 1, green: 1, blue: 1, alpha: 1 },
    fromCssColorString: vi.fn(() => ({ red: 0, green: 0, blue: 0, alpha: 1 })),
  },
}

// Mock window (modules assign to window for cross-module access)
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis
}
