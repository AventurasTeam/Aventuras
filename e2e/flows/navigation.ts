import { expect, type Page } from '@playwright/test'

import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'

// Reader → World over GO TO. The round trip pops to the World instance already on the stack, which
// keeps its category and selection, so callers pick the category they need.
export async function goToWorld(page: Page): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToWorldRow(page).click()
  await page.waitForURL(/\/world\//)
}

// World → Reader over GO TO, then the Actions menu's Undo row (CTRL-Z's touch-tier twin).
export async function undoFromReader(page: Page): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToReaderRow(page).click()
  await page.waitForURL(/\/reader-composer\//)
  await chrome.actionsTrigger(page).click()
  await reader.undoRow(page).click()
}

// Story list → reader, waiting out the story's open.
export async function openStory(page: Page, title: string): Promise<void> {
  await home.openStory(page, title).click()
  await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
}

// Story list → reader → World over GO TO.
export async function openWorld(page: Page, title: string): Promise<void> {
  await openStory(page, title)
  await goToWorld(page)
}
