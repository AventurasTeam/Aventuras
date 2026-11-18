import { expect, test, type Page } from '@playwright/test'

import { runOutcomes } from './classifier-pass'
import { openStory } from './navigation'
import {
  chapterByTitle,
  currentBranchId,
  queryApp,
  queryScalar,
  OPEN_REGION_FROM,
} from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { chrome } from '../locators/chrome'
import { closeChapter } from '../locators/close-chapter'

export const HERO_STORY = 'story_hero'
export const HERO_TITLE = 'The Veilstone Courier'
export const CHAPTER = {
  title: 'The Bargain in the Rain',
  summary: 'Kael trades a name with the watchman and follows the broker’s trail.',
  theme: 'debts paid in names',
  keywords: ['watchman', 'broker', 'rain'],
}

type Hero = { readonly app: LaunchedApp; readonly mock: MockLlm }
type Row = { id: string; position: number; kind: string }
export type Pick = { id: string; position: number; ref: string }

// Registers its describe's launch: the seeded hero, with whatever `seed` changes before launch.
// No embedder is installed: the hero's open region anchors one happening (Vorne's pact, entry 59),
// so the close's range embed has nothing to cluster. If a close fails with an embedder error, the
// region gained a second anchored happening: install one here with `installEmbedderModel`.
export function launchesHero(seed: (dbPath: string) => void = () => {}): () => Hero {
  let app: LaunchedApp | undefined
  let mock: MockLlm | undefined
  let userDataDir: string | undefined

  test.beforeAll(async () => {
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    seed(seeded.dbPath)
    mock = await startMockLlm()
    mock.setStructured('chapter-metadata', CHAPTER)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  return () => {
    if (!app || !mock) throw new Error('the hero app has not launched')
    return { app, mock }
  }
}

// The hero's open region holds 7 replies (positions 59-71).
export async function openRegion(page: Page, branchId: string): Promise<Row[]> {
  const rows = await queryApp(
    page,
    `SELECT id, position, kind ${OPEN_REGION_FROM} ORDER BY position`,
    [branchId],
  )
  return rows.map(([id, position, kind]) => ({
    id: id as string,
    position: Number(position),
    kind: kind as string,
  }))
}

// The modal defaults to the latest reply, so the one before it is a pick the user made.
export function pickBeforeLatest(region: readonly Row[]): Pick {
  const replies = region.filter((row) => row.kind === 'ai_reply')
  const pick = replies.at(-2)
  if (pick === undefined) {
    throw new Error(`the open region holds ${replies.length} replies; a pick needs two`)
  }
  return { id: pick.id, position: pick.position, ref: t('entryRef', { n: pick.position }) }
}

export const chapterCount = (page: Page, branchId: string): Promise<number> =>
  queryScalar(page, `SELECT COUNT(*) FROM chapters WHERE branch_id = ?`, [branchId])

export const closeRuns = (page: Page): Promise<(string | null)[]> =>
  runOutcomes(page, 'chapter-close', HERO_STORY)

export async function openFromMenu(page: Page): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await expect(closeChapter.storyToolsEntry(page)).toBeEnabled()
  await closeChapter.storyToolsEntry(page).click()
}

export async function pickFromMenu(page: Page, pick: Pick): Promise<void> {
  await openFromMenu(page)
  await expect(closeChapter.modal(page)).toBeVisible()
  await closeChapter.pickReply(page, pick.ref)
}

export type Start = { from: string; open: (page: Page, pick: Pick) => Promise<void> }

// milestone.md → Definition of done, Manual close: one fresh fixture per start, since the hero's
// open region has too few replies for eight closes in a row.
export function describeStart(start: Start): void {
  test.describe(`a close started from ${start.from}`, () => {
    const hero = launchesHero()

    test('ends the chapter at the picked reply, every entry through it stamped', async () => {
      test.setTimeout(120_000)
      const page = hero().app.window
      await openStory(page, HERO_TITLE)
      const branchId = await currentBranchId(page, HERO_STORY)
      const region = await openRegion(page, branchId)
      const pick = pickBeforeLatest(region)
      const chaptersBefore = await chapterCount(page, branchId)

      await start.open(page, pick)
      await closeChapter.confirm(page)

      await expect.poll(() => closeRuns(page), { timeout: 60_000 }).toEqual(['completed'])
      const chapter = await chapterByTitle(page, branchId, CHAPTER.title)
      expect({
        sequence: chapter.sequenceNumber,
        start: chapter.startEntryId,
        end: chapter.endEntryId,
      }).toEqual({ sequence: chaptersBefore + 1, start: region[0].id, end: pick.id })
      const stamps = await queryApp(
        page,
        `SELECT id, chapter_id FROM story_entries
         WHERE branch_id = ? AND id IN (${region.map(() => '?').join(', ')}) ORDER BY position`,
        [branchId, ...region.map((row) => row.id)],
      )
      expect(stamps, 'every entry through the pick stamped, those past it open').toEqual(
        region.map((row) => [row.id, row.position <= pick.position ? chapter.id : null]),
      )
    })
  })
}
