import { describe, expect, it } from 'vitest'

import { parseSlotSetting, slotAndroid, slotDataDir, slotPorts } from './slot'

describe('parseSlotSetting', () => {
  it('is off when the variable is unset or empty', () => {
    expect(parseSlotSetting(undefined)).toEqual({ kind: 'off' })
    expect(parseSlotSetting('')).toEqual({ kind: 'off' })
  })

  it('reads auto and explicit slots', () => {
    expect(parseSlotSetting('auto')).toEqual({ kind: 'auto' })
    expect(parseSlotSetting('0')).toEqual({ kind: 'fixed', slot: 0 })
    expect(parseSlotSetting('3')).toEqual({ kind: 'fixed', slot: 3 })
  })

  it.each(['10', '-1', '1.5', 'yes', ' 2'])('rejects %j', (raw) => {
    expect(() => parseSlotSetting(raw)).toThrow(/AVENTURAS_DEV_SLOT/)
  })
})

describe('slotPorts', () => {
  it('keeps slot 0 on the ports the tooling used before slots existed', () => {
    expect(slotPorts(0)).toEqual({ metro: 8081, storybook: 6006, mock: 4319, devtools: 9222 })
  })

  it('never hands two slots, or two services, the same port', () => {
    const all = Array.from({ length: 10 }, (_, slot) => Object.values(slotPorts(slot))).flat()
    expect(new Set(all).size).toBe(all.length)
  })

  // electron-mcp-server scans these and drives the first app it finds; a worker's app in the list
  // would be driven by whichever agent asked first.
  it('keeps worker DevTools ports out of electron-mcp-server’s scan list', () => {
    const scanned = [
      9222, 9223, 9224, 9225, 9200, 9201, 9202, 9203, 9204, 9205, 9300, 9301, 9302, 9303, 9304,
      9305, 9400, 9401, 9402, 9403, 9404, 9405,
    ]
    for (let slot = 1; slot <= 9; slot++) expect(scanned).not.toContain(slotPorts(slot).devtools)
  })
})

describe('slotDataDir', () => {
  it('keeps slot 0 on the dev userData dir and gives each worker its own', () => {
    expect(slotDataDir(0, '/home/u')).toBe('/home/u/.config/aventuras-dev')
    expect(slotDataDir(2, '/home/u')).toBe('/home/u/.config/aventuras-dev-slot2')
  })
})

describe('slotAndroid', () => {
  it('leaves slot 0 to whatever device the developer attached', () => {
    expect(slotAndroid(0)).toBeNull()
  })

  it('pins each worker to its own AVD and emulator serial', () => {
    expect(slotAndroid(1)).toEqual({
      avd: 'Aventuras_Slot_1',
      consolePort: 5554,
      serial: 'emulator-5554',
    })
    expect(slotAndroid(2)?.serial).toBe('emulator-5556')
  })
})
