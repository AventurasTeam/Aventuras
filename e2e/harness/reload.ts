import { expect } from '@playwright/test'

import type { LaunchedApp } from './launch'
import { NATIVE_CHANNELS } from '../../electron/native/channels'

// Driven via webContents.reload(): page.reload() awaits a load a cancelled unload never
// produces, and Playwright key events don't reach Electron's menu accelerators.
export const reloadFromMain = (app: LaunchedApp) =>
  app.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.reload()
  })

// Electron's `will-prevent-unload` (not Playwright's dialog API) decides if a reload proceeds,
// but Chromium still surfaces it to Playwright as a native `dialog` event, and left to its own
// timing Playwright intermittently loses the race and throws "No dialog is showing"
// (microsoft/playwright#36627). Dismiss it ourselves, synchronously; `.catch()` covers the race.
export function suppressNativeUnloadDialogRace(app: LaunchedApp): void {
  app.window.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => {})
  })
}

type CloseGuardSpy = typeof globalThis & { e2eCloseGuard?: boolean }

// boot() registers main's listener first and ipcMain runs listeners in order, so a `true` here
// means main's guard is armed. Register before the edit that arms it.
export const watchCloseGuard = (app: LaunchedApp) =>
  app.app.evaluate(({ ipcMain }, channel) => {
    const spy = globalThis as CloseGuardSpy
    spy.e2eCloseGuard = undefined
    ipcMain.on(channel, (_event, active: boolean) => {
      spy.e2eCloseGuard = active
    })
  }, NATIVE_CHANNELS.setCloseGuard)

// The renderer arms the guard in effects that can land renders after the dirty commit a
// locator sees; a close sent before then goes through unguarded.
export const expectCloseGuardArmed = (app: LaunchedApp) =>
  expect.poll(() => app.app.evaluate(() => (globalThis as CloseGuardSpy).e2eCloseGuard)).toBe(true)
