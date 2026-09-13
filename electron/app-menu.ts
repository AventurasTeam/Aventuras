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
  // A key combo exists only on its menu item. macOS routes ⌘Q through the app menu, ⌘W through
  // File, ⌘M through Window and text-field ⌘C / ⌘V / ⌘A through Edit.
  if (platform === 'darwin') {
    return [
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      view,
      { role: 'windowMenu' },
    ]
  }
  // Ctrl+W and Ctrl+Q; quit takes no accelerator on Windows, where Alt+F4 is native.
  return [{ label: 'File', submenu: [{ role: 'close' }, { role: 'quit' }] }, view]
}
