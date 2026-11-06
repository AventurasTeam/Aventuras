import { expect, test } from '@playwright/test'

import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir } from '../harness/seed'

// Workers launch apps side by side. On a shared X display each new window takes the focus, which
// blurs the others and closes an open Select (docs/testing.md → Virtual display).

type FocusState = { focused: boolean; blurs: number }

const countBlurs = (app: LaunchedApp) =>
  app.window.evaluate(() => {
    const counted = window as unknown as { e2eBlurs: number }
    counted.e2eBlurs = 0
    window.addEventListener('blur', () => (counted.e2eBlurs += 1))
  })

const focusState = (app: LaunchedApp): Promise<FocusState> =>
  app.window.evaluate(() => ({
    focused: document.hasFocus(),
    blurs: (window as unknown as { e2eBlurs: number }).e2eBlurs,
  }))

const launch = () =>
  launchApp({ userDataDir: createSeededUserDataDir().userDataDir, cleanupUserData: true })

test('a second launch leaves the first window focused', async () => {
  test.skip(process.env.E2E_VIRTUAL_DISPLAY !== '1', 'real windows share the one screen')
  const first = await launch()
  try {
    await countBlurs(first)
    await expect.poll(() => focusState(first)).toEqual({ focused: true, blurs: 0 })
    const second = await launch()
    try {
      // Once the second window holds the focus, a shared display has already taken it from the first.
      await expect.poll(() => second.window.evaluate(() => document.hasFocus())).toBe(true)
      expect(await focusState(first)).toEqual({ focused: true, blurs: 0 })
    } finally {
      await second.close()
    }
  } finally {
    await first.close()
  }
})
