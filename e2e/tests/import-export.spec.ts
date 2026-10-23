import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { openStory, openWorld } from '../flows/navigation'
import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { plot } from '../locators/plot'
import { toast } from '../locators/toast'
import { world } from '../locators/world'

// world.md → Per-row import and plot.md → Manual creation + per-row import, at the seams only the
// running app reaches: download, file chooser, clipboard. Unit tests: lib/avts, lib/actions/avts.

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// A seeded filler story (seed-dataset.ts) on its own branch, with no Kael of its own.
const TARGET_STORY = 'story_active2'
const TARGET_TITLE = 'Sable and the Redrawn Coast'
const EXPORT_FILE_NAME = 'character-kael.avts'

const SERVER_OWNED_KEYS = [
  'id',
  'branchId',
  'embeddingStale',
  'nameCollisionFlag',
  'nameCollisionPartnerId',
  'nameCollisionReason',
  'createdAt',
  'updatedAt',
]
const STATE_REF_KEYS = [
  'current_location_id',
  'equipped_items',
  'inventory',
  'faction_id',
  'lastSeenAt',
]

const HAPPENING_TITLE = 'The tide that came early'
// Hand-authored, with an entry ref and link rows from another story: none of them may land.
const HAPPENING_FILE = JSON.stringify({
  format: 'aventuras-happening',
  formatVersion: '1.0',
  exportedAt: '2026-10-07T00:00:00.000Z',
  happening: {
    title: HAPPENING_TITLE,
    description: 'The sea rose a day before the almanac said it would.',
    category: null,
    icon: null,
    temporal: null,
    commonKnowledge: 1,
    occurredAtEntryId: 'entry_from_another_story',
    involvements: [{ entityId: 'char_from_another_story', role: 'witness' }],
    awareness: [{ characterId: 'char_from_another_story' }],
  },
})

type Download = { path: string; state: string }
type DownloadSpy = typeof globalThis & { e2eDownloads?: Download[] }

type EntityFile = {
  format: unknown
  formatVersion: unknown
  exportedAt: unknown
  entity: Record<string, unknown> & { state: Record<string, unknown> }
}

// Without a will-download handler Electron raises a native Save dialog nothing here can drive.
async function captureDownloads(app: LaunchedApp, dir: string): Promise<void> {
  await app.app.evaluate(({ session }, saveDir) => {
    const spy = globalThis as DownloadSpy
    spy.e2eDownloads = []
    session.defaultSession.on('will-download', (_event, item) => {
      const path = `${saveDir}/${item.getFilename()}`
      item.setSavePath(path)
      item.once('done', (_done, state) => {
        spy.e2eDownloads?.push({ path, state })
      })
    })
  }, dir)
}

function downloads(app: LaunchedApp): Promise<Download[] | undefined> {
  return app.app.evaluate(() => (globalThis as DownloadSpy).e2eDownloads)
}

// Off the Xvfb display this is the developer's clipboard, so the caller restores what it returns.
function swapClipboardText(app: LaunchedApp, text: string): Promise<string> {
  return app.app.evaluate(({ clipboard }, next) => {
    const previous = clipboard.readText()
    clipboard.writeText(next)
    return previous
  }, text)
}

// GO TO pops to the reader already on the stack; the reader's back returns to the story list.
async function leaveToStoryList(page: Page): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await chrome.goToReaderRow(page).click()
  await page.waitForURL(/\/reader-composer\//)
  await chrome.back(page).click()
}

// One user_edit create, alone in its action: no link row or position write rode along.
async function expectLoneCreate(page: Page, branchId: string, id: string): Promise<void> {
  const rows = await queryApp(
    page,
    `SELECT op, source, action_id FROM deltas WHERE branch_id = ? AND target_id = ?`,
    [branchId, id],
  )
  expect(rows.map(([op, source]) => [op, source])).toEqual([['create', 'user_edit']])
  expect(
    await queryApp(page, `SELECT count(*) FROM deltas WHERE action_id = ?`, [rows[0][2]]),
  ).toEqual([[1]])
}

// Serial, one shared app: the file import reads the export's file.
test.describe.serial('Per-row .avts export and file import', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let downloadDir: string
  let heroKael: { id: string; description: string }

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    downloadDir = mkdtempSync(join(tmpdir(), 'aventuras-e2e-avts-'))
    app = await launchApp({ userDataDir, cleanupUserData: true })
    await captureDownloads(app, downloadDir)
  })

  test.afterAll(async () => {
    try {
      await app?.close()
    } finally {
      removeUserDataDir(userDataDir)
      if (downloadDir) rmSync(downloadDir, { recursive: true, force: true })
    }
  })

  test('exports a character as an aventuras-entity file without branch-local keys', async () => {
    const page = app.window
    await openWorld(page, HERO_TITLE)
    const heroBranch = await currentBranchId(page, HERO_STORY)
    const [[id, description]] = await queryApp(
      page,
      `SELECT id, description FROM entities WHERE branch_id = ? AND name = ?`,
      [heroBranch, 'Kael'],
    )
    heroKael = { id: id as string, description: description as string }

    await world.row(page, 'Kael').click()
    await expect(world.detailName(page)).toHaveText('Kael')
    await world.moreActions(page).click()
    await world.menuItem(page, 'exportEntity').click()

    const exportPath = join(downloadDir, EXPORT_FILE_NAME)
    await expect
      .poll(() => downloads(app), { timeout: 15_000 })
      .toEqual([{ path: exportPath, state: 'completed' }])

    const file = JSON.parse(readFileSync(exportPath, 'utf8')) as EntityFile
    expect([file.format, file.formatVersion]).toEqual(['aventuras-entity', '1.0'])
    expect(Number.isNaN(Date.parse(String(file.exportedAt)))).toBe(false)
    expect(file.entity).toMatchObject({
      kind: 'character',
      name: 'Kael',
      description: heroKael.description,
    })
    for (const key of SERVER_OWNED_KEYS) expect(file.entity).not.toHaveProperty(key)
    for (const key of STATE_REF_KEYS) expect(file.entity.state).not.toHaveProperty(key)
    expect(file.entity.state).toMatchObject({ traits: ['resourceful', 'wary'] })
  })

  test('imports that file into another story’s Characters and selects the new row', async () => {
    const page = app.window
    const heroBranch = await currentBranchId(page, HERO_STORY)
    await leaveToStoryList(page)
    await openWorld(page, TARGET_TITLE)
    const branchId = await currentBranchId(page, TARGET_STORY)
    expect(
      await queryApp(page, `SELECT count(*) FROM entities WHERE branch_id = ? AND name = ?`, [
        branchId,
        'Kael',
      ]),
    ).toEqual([[0]])

    await world.addTrigger(page, 'character').click()
    await world.addMenuFromJson(page).click()
    await expect(world.importDialog(page, 'character')).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await world.importFromFile(page, 'character').click()
    await (await chooser).setFiles(join(downloadDir, EXPORT_FILE_NAME))

    await expect(world.detailName(page)).toHaveText('Kael', { timeout: 15_000 })
    await expect(world.importDialog(page, 'character')).toHaveCount(0)
    await expect(toast.withText(page, t('world:import.imported'))).toBeVisible()

    const rows = await queryApp(
      page,
      `SELECT id, description, state FROM entities WHERE branch_id = ? AND name = ?`,
      [branchId, 'Kael'],
    )
    expect(rows).toHaveLength(1)
    const [[rawId, description, state]] = rows
    const id = rawId as string
    expect(id).toMatch(/^char_/)
    expect(id).not.toBe(heroKael.id)
    expect(
      await queryApp(page, `SELECT count(*) FROM entities WHERE branch_id = ? AND id = ?`, [
        heroBranch,
        id,
      ]),
    ).toEqual([[0]])
    expect(description).toBe(heroKael.description)
    expect(JSON.parse(state as string)).toMatchObject({
      current_location_id: null,
      faction_id: null,
      equipped_items: [],
      inventory: [],
      lastSeenAt: null,
      traits: ['resourceful', 'wary'],
    })
    await expectLoneCreate(page, branchId, id)
  })
})

// Its own app and hand-authored file, so a failure in the export or file legs can't skip it.
test.describe('Per-row .avts clipboard import', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let clipboardBefore: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    try {
      if (clipboardBefore !== undefined) await swapClipboardText(app, clipboardBefore)
    } finally {
      try {
        await app?.close()
      } finally {
        removeUserDataDir(userDataDir)
      }
    }
  })

  test('imports a hand-authored happening from the clipboard on Plot, the row alone', async () => {
    const page = app.window
    await openStory(page, TARGET_TITLE)
    const branchId = await currentBranchId(page, TARGET_STORY)
    expect(
      await queryApp(page, `SELECT count(*) FROM happenings WHERE branch_id = ? AND title = ?`, [
        branchId,
        HAPPENING_TITLE,
      ]),
    ).toEqual([[0]])
    await chrome.actionsTrigger(page).click()
    await chrome.goToPlotRow(page).click()
    await page.waitForURL(/\/plot\//)
    await plot.segmentCell(page, 'happening').click()
    await plot.addTrigger(page, 'happening').click()
    await plot.addMenuFromJson(page).click()
    await expect(plot.importDialog(page, 'happening')).toBeVisible()

    clipboardBefore = await swapClipboardText(app, HAPPENING_FILE)
    await plot.importFromClipboard(page, 'happening').click()

    await expect(plot.subHeader(page)).toContainText(HAPPENING_TITLE, { timeout: 15_000 })
    await expect(plot.importDialog(page, 'happening')).toHaveCount(0)

    const rows = await queryApp(
      page,
      `SELECT id, occurred_at_entry_id, temporal, common_knowledge FROM happenings WHERE branch_id = ? AND title = ?`,
      [branchId, HAPPENING_TITLE],
    )
    expect(rows).toHaveLength(1)
    const [[rawId, occurredAt, temporal, commonKnowledge]] = rows
    const id = rawId as string
    expect(id).toMatch(/^hap_/)
    expect([occurredAt, temporal, commonKnowledge]).toEqual([null, null, 1])
    for (const table of ['happening_involvements', 'happening_awareness']) {
      expect(
        await queryApp(
          page,
          `SELECT count(*) FROM ${table} WHERE branch_id = ? AND happening_id = ?`,
          [branchId, id],
        ),
      ).toEqual([[0]])
    }
    await expectLoneCreate(page, branchId, id)
  })
})
