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
    // Workers sit outside electron-mcp-server's scan list, which starts at 9222.
    devtools: slot === 0 ? 9222 : 9230 + slot,
  }
}

/** Electron userData for the slot; slot 0 is the dir `app.setName('aventuras-dev')` resolves to on Linux. */
export function slotDataDir(slot: number, home = homedir()): string {
  return join(home, '.config', slot === 0 ? 'aventuras-dev' : `aventuras-dev-slot${slot}`)
}

export function slotAndroid(slot: number): AndroidSlot | null {
  if (slot === 0) return null
  // Emulator console ports are even, from 5554; the serial is derived from it.
  const consolePort = 5552 + 2 * slot
  return { avd: `Aventuras_Slot_${slot}`, consolePort, serial: `emulator-${consolePort}` }
}
