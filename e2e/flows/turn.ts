import { expect, type Page } from '@playwright/test'

import { reader } from '../locators/reader'

// Send returning is the turn's terminal, not the reply rendering: the composer swaps Send →
// Cancel while the turn's pipeline holds a phase, and a settings save during a hard-gate run is
// rejected with `generation in flight`. isGenerating counts turn runs only, so this holds while
// nothing queues a second hard-gate run behind a turn — refreshSuggestions, the other one, is
// started only by the suggestion strip's press handlers. If a turn ever queues one, wait on the gate.
export async function waitForTurnTerminal(page: Page): Promise<void> {
  await expect(reader.send(page)).toBeVisible({ timeout: 30_000 })
}

export async function takeTurn(page: Page, action: string, marker: string): Promise<void> {
  await reader.composer(page).fill(action)
  await reader.send(page).click()
  await expect(page.getByText(marker, { exact: false })).toBeVisible({ timeout: 30_000 })
  await waitForTurnTerminal(page)
}
