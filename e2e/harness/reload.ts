import type { LaunchedApp } from './launch'

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
