import { DatabaseSync } from 'node:sqlite'

import { expect, test, type Page } from '@playwright/test'

import { goToWorld, undoFromReader } from '../flows/navigation'
import { currentBranchId, queryApp, tailMetadata } from '../harness/db'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { home } from '../locators/home'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// Fixed ids, so a restored original reads apart from a row the merge created on the older Brannoc.
const LINK_IDS = ['e2e_haw_brannoc', 'e2e_hinv_brannoc', 'e2e_rel_brannoc_mira'] as const
const FLAGGED_VIEW = 'owes a favor to'
const MIRA_VIEW = 'buys from'

// The seed gives neither Brannoc a link row or a scene place; the merge needs one of each to move.
// See docs/implementation/lessons-learned/seed-tip-position-shifts-at-boot.md for the tail anchor.
function giveFlaggedBrannocLinks(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const { branch } = db
      .prepare(`SELECT current_branch_id AS branch FROM stories WHERE id = ?`)
      .get(HERO_STORY) as { branch: string }
    const { flagged } = db
      .prepare(
        `SELECT id AS flagged FROM entities WHERE branch_id = ? AND name = 'Brannoc' AND name_collision_flag = 1`,
      )
      .get(branch) as { flagged: string }
    const { mira } = db
      .prepare(`SELECT id AS mira FROM entities WHERE branch_id = ? AND name = 'Mira'`)
      .get(branch) as { mira: string }
    const { happening } = db
      .prepare(`SELECT id AS happening FROM happenings WHERE branch_id = ? AND title = ?`)
      .get(branch, 'The market fire') as { happening: string }

    db.prepare(
      `INSERT INTO happening_awareness (id, branch_id, happening_id, character_id, learned_at_entry_id, decay_resistance, retrieval_count, source)
       VALUES (?, ?, ?, ?, NULL, 0.5, 2, 'told')`,
    ).run(LINK_IDS[0], branch, happening, flagged)
    db.prepare(
      `INSERT INTO happening_involvements (id, branch_id, happening_id, entity_id, role)
       VALUES (?, ?, ?, ?, 'smuggler on the quay')`,
    ).run(LINK_IDS[1], branch, happening, flagged)
    // CHECK a_id < b_id; both ids are ASCII, so JS and SQLite order them alike. The views follow
    // the characters, not the order: the flagged row owes Mira a favor whichever id sorts first.
    const [aId, bId, kind, inverseKind] =
      flagged < mira
        ? [flagged, mira, FLAGGED_VIEW, MIRA_VIEW]
        : [mira, flagged, MIRA_VIEW, FLAGGED_VIEW]
    db.prepare(
      `INSERT INTO character_relationships (id, branch_id, a_id, b_id, kind, inverse_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    ).run(LINK_IDS[2], branch, aId, bId, kind, inverseKind)

    const tail = db
      .prepare(
        `SELECT id, metadata FROM story_entries WHERE branch_id = ? AND kind = 'ai_reply' ORDER BY position DESC LIMIT 1`,
      )
      .get(branch) as { id: string; metadata: string }
    const metadata = JSON.parse(tail.metadata) as { sceneEntities: string[] }
    metadata.sceneEntities = [...metadata.sceneEntities, flagged]
    db.prepare(`UPDATE story_entries SET metadata = ? WHERE branch_id = ? AND id = ?`).run(
      JSON.stringify(metadata),
      branch,
      tail.id,
    )
  } finally {
    db.close()
  }
}

type BrannocPair = { branchId: string; older: string; flagged: string; mira: string }

async function scalar(page: Page, sql: string, params: unknown[]): Promise<number> {
  const [[value]] = await queryApp(page, sql, params)
  return Number(value)
}

// Read while the flags are still as seeded: only the newer Brannoc carries one.
async function brannocPair(page: Page): Promise<BrannocPair> {
  const branchId = await currentBranchId(page, HERO_STORY)
  const idOf = async (sql: string): Promise<string> => {
    const rows = await queryApp(page, sql, [branchId])
    if (rows[0] == null) throw new Error(`no row for: ${sql}`)
    return rows[0][0] as string
  }
  return {
    branchId,
    older: await idOf(
      `SELECT id FROM entities WHERE branch_id = ? AND name = 'Brannoc' AND name_collision_flag = 0`,
    ),
    flagged: await idOf(
      `SELECT id FROM entities WHERE branch_id = ? AND name = 'Brannoc' AND name_collision_flag = 1`,
    ),
    mira: await idOf(`SELECT id FROM entities WHERE branch_id = ? AND name = 'Mira'`),
  }
}

async function flags(page: Page, pair: BrannocPair) {
  // -1 once the row is gone, so an absent row can't read as a cleared flag.
  const flagOf = (id: string) =>
    scalar(
      page,
      `SELECT COALESCE((SELECT name_collision_flag FROM entities WHERE branch_id = ? AND id = ?), -1)`,
      [pair.branchId, id],
    )
  return { older: await flagOf(pair.older), flagged: await flagOf(pair.flagged) }
}

// Each relationship row between `id` and Mira as the two characters' views, so a merge that carries
// the views onto the wrong end of the a_id < b_id order shows as a swap.
async function relationshipViews(page: Page, pair: BrannocPair, id: string) {
  const rows = await queryApp(
    page,
    `SELECT a_id, kind, inverse_kind FROM character_relationships
      WHERE branch_id = ? AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)) ORDER BY id`,
    [pair.branchId, id, pair.mira, pair.mira, id],
  )
  return rows.map(([aId, kind, inverseKind]) =>
    aId === id
      ? { self: kind as string, mira: inverseKind as string }
      : { self: inverseKind as string, mira: kind as string },
  )
}

async function linksOf(page: Page, pair: BrannocPair, id: string) {
  return {
    awareness: await scalar(
      page,
      `SELECT count(*) FROM happening_awareness WHERE branch_id = ? AND character_id = ?`,
      [pair.branchId, id],
    ),
    involvements: await scalar(
      page,
      `SELECT count(*) FROM happening_involvements WHERE branch_id = ? AND entity_id = ?`,
      [pair.branchId, id],
    ),
    relationshipsWithMira: await relationshipViews(page, pair, id),
  }
}

async function pairSnapshot(page: Page, pair: BrannocPair) {
  const olderRows = await queryApp(
    page,
    `SELECT tags, status, json_extract(state, '$.current_location_id') FROM entities WHERE branch_id = ? AND id = ?`,
    [pair.branchId, pair.older],
  )
  // A missing older row reads as null fields, so a poll's last diff names the loss.
  const [tags, status, location] = olderRows[0] ?? [null, null, null]
  const scene = (await tailMetadata(page, pair.branchId))?.sceneEntities ?? []
  const b = pair.branchId
  const f = pair.flagged
  return {
    flags: await flags(page, pair),
    flaggedStale: await scalar(
      page,
      `SELECT COALESCE((SELECT embedding_stale FROM entities WHERE branch_id = ? AND id = ?), -1)`,
      [b, f],
    ),
    olderTags: tags == null ? null : (JSON.parse(tags as string) as string[]).sort(),
    olderStatus: status as string | null,
    olderLocation: location as string | null,
    originals: await scalar(
      page,
      `SELECT (SELECT count(*) FROM happening_awareness WHERE branch_id = ? AND id = ? AND character_id = ?)
            + (SELECT count(*) FROM happening_involvements WHERE branch_id = ? AND id = ? AND entity_id = ?)
            + (SELECT count(*) FROM character_relationships WHERE branch_id = ? AND id = ? AND ? IN (a_id, b_id))`,
      [b, LINK_IDS[0], f, b, LINK_IDS[1], f, b, LINK_IDS[2], f],
    ),
    older: await linksOf(page, pair, pair.older),
    flagged: await linksOf(page, pair, pair.flagged),
    scene: { older: scene.includes(pair.older), flagged: scene.includes(f) },
  }
}

const VIEWS = { self: FLAGGED_VIEW, mira: MIRA_VIEW }

function paired(flaggedStale: number) {
  return {
    flags: { older: 0, flagged: 1 },
    flaggedStale,
    olderTags: ['watch'],
    // The seeded older row is staged and has never been placed.
    olderStatus: 'staged',
    olderLocation: null,
    originals: 3,
    older: { awareness: 0, involvements: 0, relationshipsWithMira: [] },
    flagged: { awareness: 1, involvements: 1, relationshipsWithMira: [VIEWS] },
    scene: { older: false, flagged: true },
  }
}

// A merge that rewrites the tail promotes its staged canonical and seats it at the tail's location.
function merged(tailLocation: string) {
  return {
    flags: { older: 0, flagged: -1 },
    flaggedStale: -1,
    olderTags: ['smuggler', 'watch'],
    olderStatus: 'active',
    olderLocation: tailLocation,
    originals: 0,
    older: { awareness: 1, involvements: 1, relationshipsWithMira: [VIEWS] },
    flagged: { awareness: 0, involvements: 0, relationshipsWithMira: [] },
    scene: { older: true, flagged: false },
  }
}

async function logHead(page: Page, branchId: string): Promise<number> {
  return scalar(page, `SELECT COALESCE(MAX(log_position), 0) FROM deltas WHERE branch_id = ?`, [
    branchId,
  ])
}

async function writtenSince(page: Page, branchId: string, head: number) {
  const [[deltas, actions]] = await queryApp(
    page,
    `SELECT count(*), count(DISTINCT action_id) FROM deltas WHERE branch_id = ? AND log_position > ?`,
    [branchId, head],
  )
  return { deltas: Number(deltas), actions: Number(actions) }
}

// Rows of both Brannocs, whole, so a stray write to any column reads as a change.
async function brannocRows(page: Page, pair: BrannocPair): Promise<unknown[][]> {
  return queryApp(page, `SELECT * FROM entities WHERE branch_id = ? AND id IN (?, ?) ORDER BY id`, [
    pair.branchId,
    pair.older,
    pair.flagged,
  ])
}

// Serial suite, one shared app, each test starting at the reader on the pair as seeded: the guard
// test writes nothing and the keep test's undo restores the pair, so no test needs another's run.
test.describe.serial('World collision resolve', () => {
  let app: LaunchedApp
  let userDataDir: string

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    giveFlaggedBrannocLinks(seeded.dbPath)
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
    await home.openStory(app.window, HERO_TITLE).click()
    await expect(reader.composer(app.window)).toBeVisible({ timeout: 20_000 })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('a dirty pane guards Resolve: Discard opens the dialog, and closing it writes nothing', async () => {
    const page = app.window
    await goToWorld(page)
    const pair = await brannocPair(page)
    await expect(world.collisionStrip(page, 'Brannoc')).toBeVisible()
    const rowsBefore = await brannocRows(page, pair)
    const head = await logHead(page, pair.branchId)
    const [[committed]] = await queryApp(
      page,
      `SELECT description FROM entities WHERE branch_id = ? AND id = ?`,
      [pair.branchId, pair.flagged],
    )

    // Only the flagged row is in the Active tier; the staged namesake is collapsed.
    await world.row(page, 'Brannoc').click()
    await world.tab(page, 'identity').click()
    await world.description(page).fill('E2E dirty draft')

    await world.resolveButton(page).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await expect(world.collisionMode(page, 'merge')).toHaveCount(0)
    await saveSession.unsavedDiscard(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(world.collisionMode(page, 'merge')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(world.collisionMode(page, 'merge')).toHaveCount(0)

    expect(await brannocRows(page, pair)).toEqual(rowsBefore)
    expect(await flags(page, pair)).toEqual({ older: 0, flagged: 1 })
    expect(await writtenSince(page, pair.branchId, head)).toEqual({ deltas: 0, actions: 0 })
    const [[after]] = await queryApp(
      page,
      `SELECT description FROM entities WHERE branch_id = ? AND id = ?`,
      [pair.branchId, pair.flagged],
    )
    expect(after).toBe(committed)
    await expect(world.collisionStrip(page, 'Brannoc')).toBeVisible()

    // Known screen for the tests after this one.
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
  })

  test('keep as distinct clears the flag in one delta; undo re-flags the row', async () => {
    const page = app.window
    await goToWorld(page)
    const pair = await brannocPair(page)
    await expect(world.collisionStrip(page, 'Brannoc')).toBeVisible()
    expect(await flags(page, pair)).toEqual({ older: 0, flagged: 1 })
    const head = await logHead(page, pair.branchId)

    await world.resolveButton(page).click()
    await world.collisionMode(page, 'keep').click()
    await world.keepConfirm(page).click()

    await expect
      .poll(() => flags(page, pair), { timeout: 15_000 })
      .toEqual({ older: 0, flagged: 0 })
    expect(await writtenSince(page, pair.branchId, head)).toEqual({ deltas: 1, actions: 1 })
    await expect(world.collisionStrip(page, 'Brannoc')).toHaveCount(0)

    await undoFromReader(page)
    await expect
      .poll(() => flags(page, pair), { timeout: 30_000 })
      .toEqual({ older: 0, flagged: 1 })
  })

  test('merge moves the links and the scene to the older row; undo restores the pair; redo merges again', async () => {
    const page = app.window
    await goToWorld(page)
    const pair = await brannocPair(page)
    await expect(world.collisionStrip(page, 'Brannoc')).toBeVisible()
    // The seeded tail has a location, so the merge's promoted canonical takes it.
    const tailLocation = (await tailMetadata(page, pair.branchId))?.currentLocationId
    if (tailLocation == null) throw new Error('seeded tail entry has no currentLocationId')
    // The merged row must take the tail's place, not the loser's: the two differ in the seed.
    const [[loserLocation]] = await queryApp(
      page,
      `SELECT json_extract(state, '$.current_location_id') FROM entities WHERE branch_id = ? AND id = ?`,
      [pair.branchId, pair.flagged],
    )
    expect(tailLocation).not.toBe(loserLocation)
    await queryApp(page, `UPDATE entities SET embedding_stale = 0 WHERE branch_id = ? AND id = ?`, [
      pair.branchId,
      pair.flagged,
    ])
    expect(await pairSnapshot(page, pair)).toEqual(paired(0))
    const head = await logHead(page, pair.branchId)

    await world.resolveButton(page).click()
    await world.mergeConfirm(page, 'Brannoc').click()

    await expect
      .poll(() => pairSnapshot(page, pair), { timeout: 15_000 })
      .toEqual(merged(tailLocation))
    expect((await writtenSince(page, pair.branchId, head)).actions).toBe(1)
    await expect(world.collisionStrip(page, 'Brannoc')).toHaveCount(0)

    await undoFromReader(page)
    // Reverse-replay forces a restored row's embedding_stale to 1: its vectors are gone.
    await expect.poll(() => pairSnapshot(page, pair), { timeout: 30_000 }).toEqual(paired(1))

    await chrome.actionsTrigger(page).click()
    await reader.redoRow(page).click()
    await expect
      .poll(() => pairSnapshot(page, pair), { timeout: 30_000 })
      .toEqual(merged(tailLocation))
  })
})
