import { expect, test, type Locator, type Page } from '@playwright/test'

import { runOutcomes } from '../flows/classifier-pass'
import {
  goToChapterTimeline,
  goToPlot,
  goToStorySettings,
  goToWorld,
  openStory,
} from '../flows/navigation'
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
import {
  createSeededUserDataDir,
  removeUserDataDir,
  setProviderEndpoint,
  setToolCalling,
} from '../harness/seed'
import { chapterTimeline } from '../locators/chapter-timeline'
import { chrome } from '../locators/chrome'
import { closeChapter } from '../locators/close-chapter'
import { plot } from '../locators/plot'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { storySettings } from '../locators/story-settings'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// Every seeded agent target resolves to it, lore-mgmt's included (lib/db/devtools/seed-dataset.ts).
const SEEDED_MODEL = 'seed/narrative'
const CHAPTER = {
  title: 'The Bargain in the Rain',
  summary: 'Kael trades a name with the watchman and follows the broker’s trail.',
  theme: 'debts paid in names',
  keywords: ['watchman', 'broker', 'rain'],
}
// A seeded closed chapter, by title (milestone C8), whose card a draft dirties.
const SEEDED_CHAPTER = 'The Keep Leans Closer'
const DRAFT = 'E2E close-start draft'

type Hero = { readonly app: LaunchedApp; readonly mock: MockLlm }
type Row = { id: string; position: number; kind: string }
type Pick = { id: string; position: number; ref: string }

// Registers its describe's launch: the seeded hero, with whatever `seed` changes before launch.
function launchesHero(seed: (dbPath: string) => void = () => {}): () => Hero {
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

async function openRegion(page: Page, branchId: string): Promise<Row[]> {
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
function pickBeforeLatest(region: readonly Row[]): Pick {
  const replies = region.filter((row) => row.kind === 'ai_reply')
  const pick = replies.at(-2)
  if (pick === undefined) {
    throw new Error(`the open region holds ${replies.length} replies; a pick needs two`)
  }
  return { id: pick.id, position: pick.position, ref: t('entryRef', { n: pick.position }) }
}

const chapterCount = (page: Page, branchId: string): Promise<number> =>
  queryScalar(page, `SELECT COUNT(*) FROM chapters WHERE branch_id = ?`, [branchId])

const closeRuns = (page: Page): Promise<(string | null)[]> =>
  runOutcomes(page, 'chapter-close', HERO_STORY)

async function openFromMenu(page: Page): Promise<void> {
  await chrome.actionsTrigger(page).click()
  await expect(closeChapter.storyToolsEntry(page)).toBeEnabled()
  await closeChapter.storyToolsEntry(page).click()
}

async function pickFromMenu(page: Page, pick: Pick): Promise<void> {
  await openFromMenu(page)
  await expect(closeChapter.modal(page)).toBeVisible()
  await closeChapter.pickReply(page, pick.ref)
}

type Start = { from: string; open: (page: Page, pick: Pick) => Promise<void> }

// chapter-timeline.md → Chapter-close modal: every trigger opens the one modal.
const STARTS: readonly Start[] = [
  {
    from: 'the Actions menu on World',
    open: async (page, pick) => {
      await goToWorld(page)
      await pickFromMenu(page, pick)
    },
  },
  {
    from: 'the Actions menu on Plot',
    open: async (page, pick) => {
      await goToPlot(page)
      await pickFromMenu(page, pick)
    },
  },
  {
    from: 'the Actions menu on Story Settings',
    open: async (page, pick) => {
      await goToStorySettings(page)
      await pickFromMenu(page, pick)
    },
  },
  { from: 'the Actions menu on the reader', open: pickFromMenu },
  {
    from: 'the Actions menu on the Timeline',
    open: async (page, pick) => {
      await goToChapterTimeline(page)
      await pickFromMenu(page, pick)
    },
  },
  {
    from: 'the chapter popover',
    open: async (page, pick) => {
      await reader.chapterProgressHit(page).click()
      await expect(closeChapter.popoverAction(page)).toBeEnabled()
      await closeChapter.popoverAction(page).click()
      await expect(closeChapter.modal(page)).toBeVisible()
      await closeChapter.pickReply(page, pick.ref)
    },
  },
  {
    from: 'the in-progress card',
    open: async (page, pick) => {
      await goToChapterTimeline(page)
      await expect(closeChapter.inProgressCardAction(page)).toBeEnabled()
      await closeChapter.inProgressCardAction(page).click()
      await expect(closeChapter.modal(page)).toBeVisible()
      await closeChapter.pickReply(page, pick.ref)
    },
  },
  {
    from: 'Close chapter here',
    open: async (page, pick) => {
      await (await closeChapter.closeHere(page, pick.id)).click()
      await expect(closeChapter.modal(page)).toBeVisible()
      // The entry's button opens the modal with its end already picked.
      await expect(closeChapter.pickerTrigger(page)).toContainText(pick.ref)
    },
  },
]

// milestone.md → Definition of done, Manual close: one fresh fixture per start, since the hero's
// open region has too few replies for eight closes in a row.
for (const start of STARTS) {
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

// save-sessions.md → Navigate-away guard: a dirty pane asks before the modal opens, since Save
// would otherwise write a draft over the close's writes.
test.describe('Close chapter… over a dirty pane', () => {
  const hero = launchesHero()

  // Cancel keeps the draft and opens nothing; Discard drops it and opens the modal.
  async function guardedStart(page: Page, draft: Locator): Promise<void> {
    await openFromMenu(page)
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await expect(closeChapter.modal(page)).toHaveCount(0)
    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(closeChapter.modal(page)).toHaveCount(0)
    await expect(draft).toHaveValue(DRAFT)

    await openFromMenu(page)
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedDiscard(page).click()
    await expect(closeChapter.modal(page)).toBeVisible()
    await closeChapter.cancel(page)
  }

  test('raises Unsaved changes first on World, Plot, Story Settings and the Timeline', async () => {
    test.setTimeout(150_000)
    const page = hero().app.window
    await openStory(page, HERO_TITLE)
    const branchId = await currentBranchId(page, HERO_STORY)
    const chaptersBefore = await chapterCount(page, branchId)

    await test.step('World', async () => {
      await goToWorld(page)
      await world.row(page, 'Kael').click()
      await world.tab(page, 'identity').click()
      await world.description(page).fill(DRAFT)
      await guardedStart(page, world.description(page))
    })

    await test.step('Plot', async () => {
      await goToPlot(page)
      await plot.segmentCell(page, 'thread').click()
      await plot.row(page, 'What the amulet wants').click()
      await plot.tab(page, 'overview').click()
      await plot.description(page).fill(DRAFT)
      await guardedStart(page, plot.description(page))
    })

    await test.step('Story Settings', async () => {
      await goToStorySettings(page)
      await storySettings.aboutTab(page).click()
      await storySettings.aboutTitle(page).fill(DRAFT)
      await expect(storySettings.save(page)).toBeVisible()
      await guardedStart(page, storySettings.aboutTitle(page))
    })

    await test.step('the Timeline', async () => {
      await goToChapterTimeline(page)
      const seeded = await chapterByTitle(page, branchId, SEEDED_CHAPTER)
      await chapterTimeline.cardHead(page, seeded.id).click()
      await chapterTimeline.field(page, seeded.id, 'title').fill(DRAFT)
      await guardedStart(page, chapterTimeline.field(page, seeded.id, 'title'))
    })

    expect(await chapterCount(page, branchId), 'no close ran').toBe(chaptersBefore)
    expect(await closeRuns(page), 'no close run started').toEqual([])
  })
})

// The branch's system entries, the failure fields a close's entry carries, then its copy.
async function systemEntries(page: Page, branchId: string): Promise<unknown[][]> {
  return queryApp(
    page,
    `SELECT json_extract(metadata, '$.systemFailure.kind'),
            json_extract(metadata, '$.systemFailure.failure'),
            json_extract(metadata, '$.systemFailure.target'),
            json_extract(metadata, '$.systemFailure.close'),
            content
     FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
    [branchId],
  )
}

// generation-pipeline.md → Config pre-flight validation: the confirm pre-flights, so a close whose
// lore-mgmt model is flagged off for tool calling starts nothing and leaves the can't-call-tools entry.
test.describe('a close whose model is flagged unable to call tools', () => {
  const hero = launchesHero((dbPath) => setToolCalling(dbPath, SEEDED_MODEL, false))

  test('the confirm sends nothing, adds no chapter and writes the system entry', async () => {
    const page = hero().app.window
    await openStory(page, HERO_TITLE)
    const branchId = await currentBranchId(page, HERO_STORY)
    const pick = pickBeforeLatest(await openRegion(page, branchId))
    const chaptersBefore = await chapterCount(page, branchId)
    await pickFromMenu(page, pick)
    const sent = hero().mock.requests.length

    await closeChapter.confirm(page)

    // The entry replaces the branch's tail system row (writeSystemEntry keeps one per branch).
    await expect
      .poll(() => systemEntries(page, branchId), { timeout: 15_000 })
      .toEqual([
        [
          'config-resolver',
          'tool-calling-off',
          'lore-mgmt',
          'failed',
          t('reader:systemEntry.failure.closeToolCallingOff', { model: SEEDED_MODEL }),
        ],
      ])
    // raiseSystemEntry patched the loaded branch: the reader shows the entry without a reload.
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    expect(hero().mock.requests.length, 'the confirm reached no provider').toBe(sent)
    expect(await chapterCount(page, branchId)).toBe(chaptersBefore)
    expect(await closeRuns(page), 'the click pre-flight started no run').toEqual([])
  })
})
