import { DatabaseSync } from 'node:sqlite'

import { expect, test, type Page } from '@playwright/test'

import type { EntryMetadata } from '@/lib/db'

import { currentBranchId, queryApp, seedVectors, tailMetadata } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'

// The delete's tail-scene drop needs Mira in the tail's scene; seed leaves her out of it.
// See docs/implementation/lessons-learned/seed-tip-position-shifts-at-boot.md.
function putInTailScene(dbPath: string, name: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const { branch } = db
      .prepare(`SELECT current_branch_id AS branch FROM stories WHERE id = ?`)
      .get(HERO_STORY) as { branch: string }
    const { id } = db
      .prepare(`SELECT id FROM entities WHERE branch_id = ? AND name = ?`)
      .get(branch, name) as { id: string }
    const tail = db
      .prepare(
        `SELECT id, metadata FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
      )
      .get(branch) as { id: string; metadata: string }
    const metadata = JSON.parse(tail.metadata) as { sceneEntities: string[] }
    metadata.sceneEntities = [...metadata.sceneEntities, id]
    db.prepare(`UPDATE story_entries SET metadata = ? WHERE branch_id = ? AND id = ?`).run(
      JSON.stringify(metadata),
      branch,
      tail.id,
    )
  } finally {
    db.close()
  }
}

async function scalar(page: Page, sql: string, params: unknown[]): Promise<number> {
  const [[value]] = await queryApp(page, sql, params)
  return Number(value)
}

async function footprint(page: Page, branchId: string, id: string) {
  return {
    entity: await scalar(page, `SELECT count(*) FROM entities WHERE branch_id = ? AND id = ?`, [
      branchId,
      id,
    ]),
    // -1 once the row is gone, so an absent entity can't be confused with a real stale=0.
    stale: await scalar(
      page,
      `SELECT COALESCE((SELECT embedding_stale FROM entities WHERE branch_id = ? AND id = ?), -1)`,
      [branchId, id],
    ),
    awareness: await scalar(
      page,
      `SELECT count(*) FROM happening_awareness WHERE branch_id = ? AND character_id = ?`,
      [branchId, id],
    ),
    involvements: await scalar(
      page,
      `SELECT count(*) FROM happening_involvements WHERE branch_id = ? AND entity_id = ?`,
      [branchId, id],
    ),
    relationships: await scalar(
      page,
      `SELECT count(*) FROM character_relationships WHERE branch_id = ? AND (a_id = ? OR b_id = ?)`,
      [branchId, id, id],
    ),
    translations: await scalar(
      page,
      `SELECT count(*) FROM translations WHERE branch_id = ? AND target_kind = 'entity' AND target_id = ?`,
      [branchId, id],
    ),
    vec384: await scalar(
      page,
      `SELECT count(*) FROM entities_vec_384 WHERE branch_id = ? AND id = ?`,
      [branchId, id],
    ),
    vec8: await scalar(page, `SELECT count(*) FROM entities_vec_8 WHERE branch_id = ? AND id = ?`, [
      branchId,
      id,
    ]),
  }
}

// Combines footprint with the tail's whole metadata, not just sceneEntities membership, so a poll
// catches a handler that touched a field the delete shouldn't (e.g. currentLocationId, worldTime).
async function snapshot(page: Page, branchId: string, id: string) {
  return { ...(await footprint(page, branchId, id)), meta: await tailMetadata(page, branchId) }
}

async function undoFromReader(page: Page): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToReaderRow(page).click()
  await page.waitForURL(/\/reader-composer\//)
  await chrome.actionsTrigger(page).click()
  await reader.undoRow(page).click()
}

// Serial suite, one shared app: test 2 continues from test 1's navigation state (still on World,
// menu closed), mirroring world.spec.ts.
test.describe.serial('World delete', () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    putInTailScene(seeded.dbPath, 'Mira')
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('the lead’s Delete entity is disabled', async () => {
    const page = app.window
    await home.openStory(page, HERO_TITLE).click()
    await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
    await chrome.actionsTrigger(page).click()
    await chrome.goToWorldRow(page).click()
    await page.waitForURL(/\/world\//)
    await world.row(page, 'Kael').click()
    await world.moreActions(page).click()
    await expect(world.deleteEntityItem(page)).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
  })

  test('delete sweeps links, vectors and the tail scene; undo restores them; redo sweeps again', async () => {
    const page = app.window
    await expect(world.row(page, 'Mira')).toBeVisible()
    const branchId = await currentBranchId(page, HERO_STORY)
    const [[mira]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ?`,
      [branchId, 'Mira'],
    )
    const id = mira as string
    await seedVectors(page, 'entity', branchId, id)
    // The seed leaves every entity stale (1) — force 0 so undo's forced 1 (below) is provably
    // the handler's doing, not a coincidence of the fixture's own default.
    await queryApp(page, `UPDATE entities SET embedding_stale = 0 WHERE branch_id = ? AND id = ?`, [
      branchId,
      id,
    ])
    await queryApp(
      page,
      `INSERT INTO translations (id, branch_id, target_kind, target_id, field, language, translated_text, created_at, updated_at)
       VALUES (?, ?, 'entity', ?, 'description', 'es', 'La mercader.', 1, 1)`,
      ['e2e_translation_mira', branchId, id],
    )
    const metaBefore = await tailMetadata(page, branchId)
    if (metaBefore == null) throw new Error(`branch ${branchId} has no tail metadata`)
    const metaAfterDelete: EntryMetadata = {
      ...metaBefore,
      sceneEntities: metaBefore.sceneEntities.filter((other) => other !== id),
    }

    const before = await footprint(page, branchId, id)
    expect(before).toEqual({
      entity: 1,
      stale: 0,
      awareness: 2,
      involvements: 1,
      relationships: 2,
      translations: 1,
      vec384: 1,
      vec8: 1,
    })
    expect(metaBefore.sceneEntities).toContain(id)
    const headBefore = await scalar(
      page,
      `SELECT COALESCE(MAX(log_position), 0) FROM deltas WHERE branch_id = ?`,
      [branchId],
    )

    await world.row(page, 'Mira').click()
    await world.moreActions(page).click()
    await world.deleteEntityItem(page).click()
    await expect(world.deleteDialog(page)).toContainText(t('world:delete.awareness', { count: 2 }))
    await expect(world.deleteDialog(page)).toContainText(t('world:delete.tailScene'))
    await world.deleteConfirm(page, 'character').click()

    await expect
      .poll(() => snapshot(page, branchId, id), { timeout: 15_000 })
      .toEqual({
        entity: 0,
        stale: -1,
        awareness: 0,
        involvements: 0,
        relationships: 0,
        translations: 0,
        vec384: 0,
        vec8: 0,
        meta: metaAfterDelete,
      })
    expect(
      await scalar(
        page,
        `SELECT count(DISTINCT action_id) FROM deltas WHERE branch_id = ? AND log_position > ?`,
        [branchId, headBefore],
      ),
    ).toBe(1)

    await undoFromReader(page)
    await expect
      .poll(() => snapshot(page, branchId, id), { timeout: 30_000 })
      .toEqual({
        entity: 1,
        // Reverse-replay forces every restored row's embedding_stale back to 1 (its vectors
        // are gone), regardless of the value the delete's undoPayload captured.
        stale: 1,
        awareness: 2,
        involvements: 1,
        relationships: 2,
        translations: 1,
        vec384: 0,
        vec8: 0,
        meta: metaBefore,
      })

    // A re-embed between undo and redo: the redo must sweep what it finds, not what the delete saw.
    await seedVectors(page, 'entity', branchId, id)
    const preRedo = await footprint(page, branchId, id)
    expect(preRedo.vec384).toBe(1)
    expect(preRedo.vec8).toBe(1)

    await chrome.actionsTrigger(page).click()
    await reader.redoRow(page).click()
    await expect
      .poll(() => snapshot(page, branchId, id), { timeout: 30_000 })
      .toEqual({
        entity: 0,
        stale: -1,
        awareness: 0,
        involvements: 0,
        relationships: 0,
        translations: 0,
        vec384: 0,
        vec8: 0,
        meta: metaAfterDelete,
      })
  })
})
