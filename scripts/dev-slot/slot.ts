import { homedir } from 'node:os'
import { join } from 'node:path'

/** Highest worker slot; slot 0 is the unslotted default. */
export const MAX_SLOT = 9

export type SlotSetting = { kind: 'off' } | { kind: 'auto' } | { kind: 'fixed'; slot: number }

export type SlotPorts = { metro: number; storybook: number; mock: number; devtools: number }

export type AndroidSlot = { avd: string; consolePort: number; serial: string }

/** `AVENTURAS_DEV_SLOT`: unset or empty is off, `auto` claims one per worktree, 0-9 pins one. */
export function parseSlotSetting(raw: string | undefined): SlotSetting {
  if (raw === undefined || raw === '') return { kind: 'off' }
  if (raw === 'auto') return { kind: 'auto' }
  if (/^\d$/.test(raw)) return { kind: 'fixed', slot: Number(raw) }
  throw new Error(`AVENTURAS_DEV_SLOT must be "auto" or a slot from 0 to ${MAX_SLOT}, got "${raw}"`)
}

export function slotPorts(slot: number): SlotPorts {
  return {
    metro: 8081 + slot,
    storybook: 6006 + slot,
    mock: 4319 + slot,
    // Workers stay clear of 9222-9225, the range CDP tooling probes by default.
    devtools: slot === 0 ? 9222 : 9230 + slot,
  }
}

/** The environment Electron's paths depend on; any process env satisfies it. */
export type DataDirEnv = {
  XDG_CONFIG_HOME?: string
  APPDATA?: string
  [name: string]: string | undefined
}

export type DataDirOptions = { home?: string; env?: DataDirEnv; platform?: NodeJS.Platform }

// Electron's `appData`, which userData sits in: Chromium resolves it this way per platform.
function appDataDir(home: string, env: DataDirEnv, platform: NodeJS.Platform): string {
  if (platform === 'win32') return env.APPDATA || join(home, 'AppData', 'Roaming')
  if (platform === 'darwin') return join(home, 'Library', 'Application Support')
  return env.XDG_CONFIG_HOME || join(home, '.config')
}

/**
 * Electron userData for the slot. Slot 0 is where `app.setName('aventuras-dev')` puts the dev app;
 * a worker slot is passed to Electron explicitly, beside it.
 */
export function slotDataDir(slot: number, opts: DataDirOptions = {}): string {
  const { home = homedir(), env = process.env, platform = process.platform } = opts
  const name = slot === 0 ? 'aventuras-dev' : `aventuras-dev-slot${slot}`
  return join(appDataDir(home, env, platform), name)
}

export function slotAndroid(slot: number): AndroidSlot | null {
  if (slot === 0) return null
  // Emulator console ports are even, from 5554; the serial is derived from it.
  const consolePort = 5552 + 2 * slot
  return { avd: `Aventuras_Slot_${slot}`, consolePort, serial: `emulator-${consolePort}` }
}
