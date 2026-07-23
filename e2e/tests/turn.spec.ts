import { expect, test, type Page } from '@playwright/test'

import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { home } from '../locators/home'

async function dbRows(page: Page, sql: string, params: unknown[] = []): Promise<unknown[][]> {
  const result = await page.evaluate(
    ({ sql, params }) =>
      (
        window as unknown as {
          aventurasDb: {
            query: (s: string, p: unknown[], m: string) => Promise<{ rows: unknown[][] }>
          }
        }
      ).aventurasDb.query(sql, params, 'all'),
    { sql, params },
  )
  return result.rows
}

// A distinctive marker so the reply is unambiguous in both DOM and DB.
const REPLY = 'E2E-TURN-MARKER — the blade sings and the rain leans in.'

test.describe('reader turn against the mock LLM', () => {
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

  test('submits a user action and commits the mock AI reply on the seeded story', async () => {
    // Open the seeded hero story into the reader.
    await home.openStory(app.window, 'The Veilstone Courier').click()

    const composer = app.window.getByPlaceholder(t('reader:composerPlaceholder'))
    await expect(composer).toBeVisible({ timeout: 20_000 })

    // Marker keeps the query off seeded action lines (the hero branch already
    // has "I draw the blade …").
    await composer.fill('E2E-USER-MARKER I draw the blade and wait.')
    await app.window.getByRole('button', { name: t('reader:send') }).click()

    // The streamed reply renders in the document.
    await expect(app.window.getByText('E2E-TURN-MARKER', { exact: false })).toBeVisible({
      timeout: 30_000,
    })

    // The narrative call actually hit the mock as a streaming request.
    expect(mock.requests.some((r) => r.streamed)).toBe(true)

    // Both the user action and the AI reply are committed to the branch.
    const branchId = (
      await dbRows(app.window, `SELECT current_branch_id FROM stories WHERE id = 'story_hero'`)
    )[0][0] as string

    const reply = await dbRows(
      app.window,
      `SELECT kind FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-TURN-MARKER%'`,
      [branchId],
    )
    expect(reply.length, 'AI reply entry committed').toBe(1)

    const userEntry = await dbRows(
      app.window,
      `SELECT kind FROM story_entries WHERE branch_id = ? AND content LIKE '%E2E-USER-MARKER%'`,
      [branchId],
    )
    expect(userEntry.length, 'user action entry committed').toBe(1)
  })
})
