import { describe, expect, it } from 'vitest'

import { appMenuTemplate } from './app-menu'

type Item = { role?: string; label?: string; submenu?: unknown }

function roles(items: readonly Item[]): string[] {
  return items.flatMap((item) => [
    ...(item.role != null ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu as Item[]) : []),
  ])
}

describe('appMenuTemplate', () => {
  it.each(['linux', 'win32', 'darwin'] as const)(
    'binds no reload or devtools on %s, and keeps zoom',
    (platform) => {
      const all = roles(appMenuTemplate(platform))
      for (const banned of ['reload', 'forceReload', 'toggleDevTools', 'viewMenu']) {
        expect(all).not.toContain(banned)
      }
      expect(all).toEqual(expect.arrayContaining(['zoomIn', 'zoomOut', 'resetZoom']))
    },
  )

  it('keeps the app, File, Edit and Window menus on macOS, where ⌘Q, ⌘W, ⌘M and ⌘C / ⌘V live', () => {
    expect(roles(appMenuTemplate('darwin'))).toEqual(
      expect.arrayContaining(['appMenu', 'fileMenu', 'editMenu', 'windowMenu']),
    )
  })

  // Menu accelerators are the only binding: a key combo without its menu item does nothing.
  it('binds Close and Quit on Linux and Windows, which carry Ctrl+W and Ctrl+Q', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(roles(appMenuTemplate(platform))).toEqual(expect.arrayContaining(['close', 'quit']))
    }
  })
})
