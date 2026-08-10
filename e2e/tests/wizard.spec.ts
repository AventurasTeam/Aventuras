import { expect, test } from '@playwright/test'

import { createAdventureStory } from '../flows/create-story'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { wizard } from '../locators/wizard'

test.describe('create-story wizard', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  const STORY = {
    lead: 'Wren Calloway',
    title: 'The Salt Road',
    opening: 'The tide went out and did not come back.',
    lore: [
      { title: 'The Salt Wells', body: 'Nine wells ring the drowned coast.' },
      { title: 'The Tide Charter', body: 'The old law that binds the wells.' },
    ],
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
    const storyRows = await queryApp(
      app.window,
      `SELECT id, current_branch_id, status FROM stories WHERE title = ?`,
      [STORY.title],
    )
    expect(storyRows.length, 'exactly one story with the title').toBe(1)
    const [, branchId, status] = storyRows[0] as [string, string, string]
    expect(status).toBe('active')

    // Lead entity persisted on the story's branch.
    const entityRows = await queryApp(
      app.window,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ? AND kind = 'character'`,
      [branchId, STORY.lead],
    )
    expect(entityRows.length, 'lead entity row').toBe(1)
    const leadId = (entityRows[0] as [string])[0]

    // The real embed populated the vec0 table for the lead (dim 384).
    const vecRows = await queryApp(
      app.window,
      `SELECT count(*) FROM entities_vec_384 WHERE id = ? AND branch_id = ?`,
      [leadId, branchId],
    )
    expect((vecRows[0] as [number])[0], 'lead entity has a stored embedding').toBe(1)

    // Both lore rows committed on the branch.
    const loreRows = await queryApp(
      app.window,
      `SELECT id FROM lore WHERE branch_id = ? ORDER BY title`,
      [branchId],
    )
    expect(loreRows.length, 'both lore rows committed').toBe(2)

    // The real embed populated lore_vec for each row (dim 384) — asserting the
    // settled end state, never the embedding_stale handoff flag.
    for (const [loreId] of loreRows as [string][]) {
      const vec = await queryApp(
        app.window,
        `SELECT count(*) FROM lore_vec_384 WHERE id = ? AND branch_id = ?`,
        [loreId, branchId],
      )
      expect((vec[0] as [number])[0], `lore row ${loreId} has a stored embedding`).toBe(1)
    }
  })
})
