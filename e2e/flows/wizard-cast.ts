import { expect, type Page } from '@playwright/test'

import { wizard, type CastKind } from '../locators/wizard'

// Cast rows mint their id client-side (wizardStore.addCast, lib/stores/wizard/wizard.ts)
// and stay Zustand-only until Finish commits — createStoryWithBranch
// (lib/actions/stories/create-story.ts) reuses the wizard-minted id verbatim as
// the entities.id it inserts, rather than minting a fresh one. So there is no
// Tier-1 DB read available while authoring: the row doesn't exist in any table
// yet. addCast always appends (castOps.append), so the row this click just
// added is the last row anchor in DOM order regardless of how many earlier
// rows are expanded or collapsed — reading its `data-cast-id` off the DOM
// (the same anchor the row-scoped locators key off) is the only way the spec
// learns the id the rest of that row's fields must scope through.
export async function addCastRow(page: Page, kind: CastKind): Promise<string> {
  await wizard.addCast(page).click()
  await wizard.addCastKind(page, kind).click()
  const row = wizard.castRows(page).last()
  await expect(row).toBeVisible()
  const id = await row.getAttribute('data-cast-id')
  if (!id) throw new Error('cast row rendered with no data-cast-id')
  return id
}
