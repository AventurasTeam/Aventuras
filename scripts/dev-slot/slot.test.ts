import { join } from 'node:path'

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
})

describe('slotDataDir', () => {
  const linux = { home: '/home/u', env: {}, platform: 'linux' } as const

  it('keeps slot 0 on the dev userData dir and gives each worker its own', () => {
    expect(slotDataDir(0, linux)).toBe(join('/home/u', '.config', 'aventuras-dev'))
    expect(slotDataDir(2, linux)).toBe(join('/home/u', '.config', 'aventuras-dev-slot2'))
  })

  it('follows XDG_CONFIG_HOME on Linux, as Electron does', () => {
    const env = { XDG_CONFIG_HOME: '/xdg' }
    expect(slotDataDir(0, { ...linux, env })).toBe(join('/xdg', 'aventuras-dev'))
  })

  it('uses Electron’s app data dir on macOS and Windows', () => {
    expect(slotDataDir(0, { home: '/Users/u', env: {}, platform: 'darwin' })).toBe(
      join('/Users/u', 'Library', 'Application Support', 'aventuras-dev'),
    )
    expect(
      slotDataDir(1, { home: 'C:/Users/u', env: { APPDATA: 'D:/Roaming' }, platform: 'win32' }),
    ).toBe(join('D:/Roaming', 'aventuras-dev-slot1'))
    expect(slotDataDir(1, { home: 'C:/Users/u', env: {}, platform: 'win32' })).toBe(
      join('C:/Users/u', 'AppData', 'Roaming', 'aventuras-dev-slot1'),
    )
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
