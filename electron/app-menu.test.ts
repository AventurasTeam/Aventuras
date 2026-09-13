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
      for (const banned of ['reload', 'forceReload', 'toggleDevTools', 'viewMenu', 'windowMenu']) {
        expect(all).not.toContain(banned)
      }
      expect(all).toEqual(expect.arrayContaining(['zoomIn', 'zoomOut', 'resetZoom']))
    },
  )

  it('keeps the app and Edit menus on macOS, where ⌘Q and text-field ⌘C / ⌘V live', () => {
    expect(roles(appMenuTemplate('darwin'))).toEqual(
      expect.arrayContaining(['appMenu', 'editMenu']),
    )
  })

  it('carries only the View menu on Linux and Windows', () => {
    for (const platform of ['linux', 'win32'] as const) {
      expect(appMenuTemplate(platform).map((item) => item.label ?? item.role)).toEqual(['View'])
    }
  })
})
