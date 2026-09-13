import { expect, test } from '@playwright/test'

import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'

type MenuLike = { items: { role?: string; submenu?: MenuLike | null }[] } | null

// Menu accelerators are main-process state Playwright's key events never reach, so this reads
// the application menu itself. The dev half doubles as proof the role walk can see a reload.
test.describe('application menu', () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('packaged builds bind no reload or devtools; dev keeps the default menu', async () => {
    const { roles, autoHide } = await app.app.evaluate(({ BrowserWindow, Menu }) => {
      const walk = (menu: MenuLike): string[] =>
        (menu?.items ?? []).flatMap((item) => [
          ...(item.role != null ? [item.role.toLowerCase()] : []),
          ...walk(item.submenu ?? null),
        ])
      return {
        roles: walk(Menu.getApplicationMenu() as MenuLike),
        autoHide: BrowserWindow.getAllWindows()[0].isMenuBarAutoHide(),
      }
    })

    if (test.info().project.name === 'packaged') {
      for (const banned of ['reload', 'forcereload', 'toggledevtools']) {
        expect(roles).not.toContain(banned)
      }
      expect(roles).toEqual(expect.arrayContaining(['zoomin', 'zoomout', 'resetzoom']))
      expect(autoHide).toBe(true)
    } else {
      expect(roles).toContain('reload')
      expect(autoHide).toBe(false)
    }
  })
})
