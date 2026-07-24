import { expect, test } from '@playwright/test'

import { createCreativeStory } from '../flows/create-story'
import { queryApp } from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { home } from '../locators/home'
import { wizard } from '../locators/wizard'

// The common alternative to the adventure happy path: creative mode has no lead
// (needsLead false), so Finish commits the story without an embed pass. Proves
// the no-lead branch of finishWizard end-to-end. See docs/testing.md → Coverage.
test.describe('create-story wizard — creative mode', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  const STORY = {
    title: 'The Glass Orchard',
    opening: 'Nothing in the orchard had borne fruit since the frost.',
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    ;({ userDataDir } = createSeededUserDataDir())
    // A usable embedder clears the (mode-independent) entry gate; creative still
    // embeds nothing on Finish.
    await installEmbedderModel(userDataDir)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('commits a creative story with no lead and no embedding', async () => {
    await home.newStory(app.window).click()
    await expect(wizard.modeOption(app.window, 'creative')).toBeVisible({ timeout: 15_000 })

    await createCreativeStory(app.window, STORY)

    const storyRows = await queryApp(
      app.window,
      `SELECT current_branch_id, status FROM stories WHERE title = ?`,
      [STORY.title],
    )
    expect(storyRows.length, 'exactly one story with the title').toBe(1)
    const [branchId, status] = storyRows[0] as [string, string]
    expect(status).toBe('active')

    // No lead ⇒ no entity created ⇒ nothing embeddable. Zero entities on the
    // branch is the direct, stable proof that the embed pass had no work.
    const entityCount = await queryApp(
      app.window,
      `SELECT count(*) FROM entities WHERE branch_id = ?`,
      [branchId],
    )
    expect((entityCount[0] as [number])[0], 'no entities on a creative branch').toBe(0)
  })
})
