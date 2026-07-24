import { expect, test, type Page } from '@playwright/test'

import { createAdventureStory } from '../flows/create-story'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { wizard } from '../locators/wizard'

// Query the fixture DB through the app's own bridge (window.aventurasDb) so the
// read goes through the same main-process connection that just wrote — the
// faithful outcome check (docs/testing.md → Selector strategy, Tier 1).
// sqlite-proxy hands back rows as arrays-of-values.
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

test.describe('create-story wizard', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  const STORY = {
    lead: 'Wren Calloway',
    title: 'The Salt Road',
    opening: 'The tide went out and did not come back.',
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ;({ userDataDir } = createSeededUserDataDir())
    await installEmbedderModel(userDataDir)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('creates a story and embeds its lead entity through the real pipeline', async () => {
    // The seeded embedder clears the wizard's hard entry gate.
    await home.newStory(app.window).click()
    await expect(wizard.modeOption(app.window, 'adventure')).toBeVisible({ timeout: 15_000 })

    await createAdventureStory(app.window, STORY)

    // Story row committed and active.
    const storyRows = await dbRows(
      app.window,
      `SELECT id, current_branch_id, status FROM stories WHERE title = ?`,
      [STORY.title],
    )
    expect(storyRows.length, 'exactly one story with the title').toBe(1)
    const [, branchId, status] = storyRows[0] as [string, string, string]
    expect(status).toBe('active')

    // Lead entity persisted on the story's branch.
    const entityRows = await dbRows(
      app.window,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ? AND kind = 'character'`,
      [branchId, STORY.lead],
    )
    expect(entityRows.length, 'lead entity row').toBe(1)
    const leadId = (entityRows[0] as [string])[0]

    // The real embed populated the vec0 table for the lead (dim 384).
    const vecRows = await dbRows(
      app.window,
      `SELECT count(*) FROM entities_vec_384 WHERE id = ? AND branch_id = ?`,
      [leadId, branchId],
    )
    expect((vecRows[0] as [number])[0], 'lead entity has a stored embedding').toBe(1)
  })
})
