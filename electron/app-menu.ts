import type { MenuItemConstructorOptions } from 'electron'

/**
 * The packaged build's menu. Electron's default ships Reload and Toggle Developer Tools, and a
 * reload remounts the current route with nothing beneath it; dev keeps the default.
 */
export function appMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
  // macOS routes ⌘Q through the app menu and text-field ⌘C / ⌘V / ⌘A through Edit.
  if (platform === 'darwin') return [{ role: 'appMenu' }, { role: 'editMenu' }, view]
  return [view]
}
