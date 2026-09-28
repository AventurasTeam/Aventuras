// e2e/tests/world-delete-undo.spec.ts
import { DatabaseSync } from 'node:sqlite'

import { expect, test, type Page } from '@playwright/test'

import { currentBranchId, queryApp, tailMetadata } from '../harness/db'
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

// The delete's tail-scene drop needs Mira in the tail's scene; the seed leaves her out of it.
// lessons-learned → seed tip: the last ai_reply is the tail boot recovery can't remove.
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

async function seedVectors(page: Page, branchId: string, id: string): Promise<void> {
  await queryApp(
    page,
    `CREATE VIRTUAL TABLE IF NOT EXISTS entities_vec_8 USING vec0(pk text primary key, branch_id text partition key, model_id text, id text, +source_hash text, embedding float[8])`,
  )
  for (const dim of [384, 8]) {
    await queryApp(
      page,
      `INSERT INTO entities_vec_${dim} (pk, branch_id, model_id, id, source_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `${branchId}:${id}:e2e${dim}`,
        branchId,
        `e2e${dim}`,
        id,
        'h',
        new Uint8Array(new Float32Array(dim).buffer),
      ],
    )
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
    vectors:
      (await scalar(page, `SELECT count(*) FROM entities_vec_384 WHERE branch_id = ? AND id = ?`, [
        branchId,
        id,
      ])) +
      (await scalar(page, `SELECT count(*) FROM entities_vec_8 WHERE branch_id = ? AND id = ?`, [
        branchId,
        id,
      ])),
    inTailScene: ((await tailMetadata(page, branchId))?.sceneEntities ?? []).includes(id),
  }
}

async function readerAction(page: Page, row: 'undoRow' | 'redoRow'): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToReaderRow(page).click()
  await page.waitForURL(/\/reader-composer\//)
  await chrome.actionsTrigger(page).click()
  await reader[row](page).click()
}

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
    const branchId = await currentBranchId(page, HERO_STORY)
    const [[mira]] = await queryApp(
      page,
      `SELECT id FROM entities WHERE branch_id = ? AND name = ?`,
      [branchId, 'Mira'],
    )
    const id = mira as string
    await seedVectors(page, branchId, id)
    const before = await footprint(page, branchId, id)
    expect(before).toEqual({
      entity: 1,
      awareness: 2,
      involvements: 1,
      relationships: 2,
      vectors: 2,
      inTailScene: true,
    })
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
      .poll(() => footprint(page, branchId, id), { timeout: 15_000 })
      .toEqual({
        entity: 0,
        awareness: 0,
        involvements: 0,
        relationships: 0,
        vectors: 0,
        inTailScene: false,
      })
    expect(
      await scalar(
        page,
        `SELECT count(DISTINCT action_id) FROM deltas WHERE branch_id = ? AND log_position > ?`,
        [branchId, headBefore],
      ),
    ).toBe(1)

    await readerAction(page, 'undoRow')
    await expect
      .poll(() => footprint(page, branchId, id), { timeout: 30_000 })
      .toEqual({
        entity: 1,
        awareness: 2,
        involvements: 1,
        relationships: 2,
        vectors: 0,
        inTailScene: true,
      })

    // A re-embed between undo and redo: the redo must sweep what it finds, not what the delete saw.
    await seedVectors(page, branchId, id)
    await chrome.actionsTrigger(page).click()
    await reader.redoRow(page).click()
    await expect
      .poll(() => footprint(page, branchId, id), { timeout: 30_000 })
      .toEqual({
        entity: 0,
        awareness: 0,
        involvements: 0,
        relationships: 0,
        vectors: 0,
        inTailScene: false,
      })
  })
})
