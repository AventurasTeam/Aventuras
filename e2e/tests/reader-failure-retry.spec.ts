import { expect, test } from '@playwright/test'

import { queryApp } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Generation failure → retry (edge case): a failed narrative call surfaces a
// system entry with a Retry action; retrying (with the failure cleared) commits
// the reply and clears the system entry. The failure is injected at the mock's
// transport, so the whole pipeline error path runs for real. See
// docs/testing.md → Coverage + Mock LLM.
const REPLY = 'E2E-FAILRETRY-REPLY the courier finally answers.'

test.describe('reader — turn failure then retry', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    mock = await startMockLlm()
    mock.setNarrative(REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  async function systemCount(branchId: string): Promise<number> {
    return (
      (
        await queryApp(
          app.window,
          `SELECT count(*) FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
          [branchId],
        )
      )[0] as [number]
    )[0]
  }

  test('surfaces a retriable system entry on failure, then commits on retry', async () => {
    mock.failNextNarrative()

    await home.openStory(app.window, 'The Veilstone Courier').click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
    await reader.composer(app.window).fill('E2E-FAILRETRY-USER I call out.')
    await reader.send(app.window).click()

    // The failed turn writes a system entry with a Retry action.
    await expect(reader.retrySystemEntry(app.window)).toBeVisible({ timeout: 30_000 })
    const branchId = (
      await queryApp(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string
    expect(await systemCount(branchId), 'system entry written on failure').toBe(1)

    // Retry: the failure is one-shot, so the next narrative call succeeds.
    await reader.retrySystemEntry(app.window).click()
    await expect(app.window.getByText('E2E-FAILRETRY-REPLY', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    const reply = await queryApp(
      app.window,
      `SELECT id FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-FAILRETRY-REPLY%'`,
      [branchId],
    )
    expect(reply.length, 'reply committed on retry').toBe(1)
    await expect.poll(() => systemCount(branchId), { timeout: 15_000 }).toBe(0)
  })
})
