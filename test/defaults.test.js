import { describe, it, expect } from 'vitest'
import DEFAULT_SETTINGS from '../src/defaults.js'

describe('DEFAULT_SETTINGS', () => {
  it('exports an object with expected keys', () => {
    expect(DEFAULT_SETTINGS).toBeDefined()
    expect(typeof DEFAULT_SETTINGS).toBe('object')
  })

  it('has correct default values for core settings', () => {
    expect(DEFAULT_SETTINGS.fontSize).toBe(12)
    expect(DEFAULT_SETTINGS.theme).toBe('system')
    expect(DEFAULT_SETTINGS.darkColor).toBe('#cccccc')
    expect(DEFAULT_SETTINGS.lightColor).toBe('#000000')
    expect(DEFAULT_SETTINGS.colorByAltitude).toBe(true)
    expect(DEFAULT_SETTINGS.labelsEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.aircraftEnabled).toBe(false)
  })

  it('has a valid savedView with required properties', () => {
    const { savedView } = DEFAULT_SETTINGS
    expect(savedView).toBeDefined()
    expect(typeof savedView.lon).toBe('number')
    expect(typeof savedView.lat).toBe('number')
    expect(typeof savedView.height).toBe('number')
    expect(typeof savedView.heading).toBe('number')
    expect(typeof savedView.pitch).toBe('number')
  })

  it('has empty string defaults for credentials', () => {
    expect(DEFAULT_SETTINGS.openskyClientId).toBe('')
    expect(DEFAULT_SETTINGS.openskyClientSecret).toBe('')
    expect(DEFAULT_SETTINGS.flightawareApiKey).toBe('')
  })

  it('has empty searchHistory array', () => {
    expect(Array.isArray(DEFAULT_SETTINGS.searchHistory)).toBe(true)
    expect(DEFAULT_SETTINGS.searchHistory).toHaveLength(0)
  })
})
