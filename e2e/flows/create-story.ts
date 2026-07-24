import { expect, type Page } from '@playwright/test'

import { wizard } from '../locators/wizard'

export type NewAdventureStory = { lead: string; title: string; opening: string }

// Drive the wizard end-to-end to create an adventure story with a lead entity —
// the path create-story.ts embeds the lead through the local embedder. Assumes
// the wizard is already open (past the embedder gate) on step 1. Steps run
// 1 → 2 → 5; the calendar step self-populates a valid origin on mount.
export async function createAdventureStory(page: Page, story: NewAdventureStory): Promise<void> {
  // Step 1 — adventure mode surfaces the lead-name field (needsLead).
  await wizard.modeOption(page, 'adventure').click()
  await wizard.leadName(page).fill(story.lead)
  await wizard.next(page).click()

  // Step 2 — calendar defaults are valid; advance.
  await wizard.next(page).click()

  // Step 5 — opening + title are the remaining Finish requirements.
  await expect(wizard.opening(page)).toBeVisible()
  await wizard.opening(page).fill(story.opening)
  await wizard.title(page).fill(story.title)

  await wizard.finish(page).click()

  // Finish commits the story and routes to the reader.
  await page.waitForURL(/\/reader-composer\//, { timeout: 30_000 })
}
