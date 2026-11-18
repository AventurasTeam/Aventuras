import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  chapterCount,
  closeRuns,
  HERO_STORY,
  HERO_TITLE,
  launchesHero,
  openFromMenu,
  openRegion,
  pickBeforeLatest,
  pickFromMenu,
} from '../flows/close-start'
import {
  goToChapterTimeline,
  goToPlot,
  goToStorySettings,
  goToWorld,
  openStory,
} from '../flows/navigation'
import { chapterByTitle, currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { setToolCalling } from '../harness/seed'
import { chapterTimeline } from '../locators/chapter-timeline'
import { closeChapter } from '../locators/close-chapter'
import { plot } from '../locators/plot'
import { reader } from '../locators/reader'
import { saveSession } from '../locators/save-session'
import { storySettings } from '../locators/story-settings'
import { world } from '../locators/world'

// Every seeded agent target resolves to it, lore-mgmt's included (lib/db/devtools/seed-dataset.ts).
const SEEDED_MODEL = 'seed/narrative'
// A seeded closed chapter, by title (milestone C8), whose card a draft dirties.
const SEEDED_CHAPTER = 'The Keep Leans Closer'
const DRAFT = 'E2E close-start draft'

// save-sessions.md → Navigate-away guard: a dirty pane asks before the modal opens, since Save
// would otherwise write a draft over the close's writes.
test.describe('Close chapter… over a dirty pane', () => {
  const hero = launchesHero()

  // Cancel keeps the draft and opens nothing; Discard drops it and opens the modal.
  async function guardedStart(page: Page, draft: Locator): Promise<void> {
    await openFromMenu(page)
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await expect(closeChapter.mounted(page)).toHaveCount(0)
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

// The branch's system entries, the failure fields a close's entry carries (closePick is the click
// pre-flight's: its Retry restarts that pick), then its copy.
async function systemEntries(page: Page, branchId: string): Promise<unknown[][]> {
  return queryApp(
    page,
    `SELECT json_extract(metadata, '$.systemFailure.kind'),
            json_extract(metadata, '$.systemFailure.failure'),
            json_extract(metadata, '$.systemFailure.target'),
            json_extract(metadata, '$.systemFailure.close'),
            json_extract(metadata, '$.systemFailure.closePick'),
            content
     FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
    [branchId],
  )
}

// A system entry's id changes with every rewrite (writeSystemEntry), so it tells a Retry ran.
async function systemEntryIds(page: Page, branchId: string): Promise<{ id: string }[]> {
  const rows = await queryApp(
    page,
    `SELECT id FROM story_entries WHERE branch_id = ? AND kind = 'system'`,
    [branchId],
  )
  return rows.map(([id]) => ({ id: id as string }))
}

// generation-pipeline.md → Config pre-flight validation: the confirm pre-flights, so a close whose
// lore-mgmt model is flagged off for tool calling starts nothing and leaves the can't-call-tools entry.
test.describe('a close whose model is flagged unable to call tools', () => {
  const hero = launchesHero((dbPath) => setToolCalling(dbPath, SEEDED_MODEL, false))

  test('the confirm sends nothing, writes the system entry and its Retry keeps the pick', async () => {
    const page = hero().app.window
    await openStory(page, HERO_TITLE)
    const branchId = await currentBranchId(page, HERO_STORY)
    const pick = pickBeforeLatest(await openRegion(page, branchId))
    const chaptersBefore = await chapterCount(page, branchId)
    await pickFromMenu(page, pick)
    const sent = hero().mock.requests.length

    await closeChapter.confirm(page)

    // The entry replaces the branch's tail system row (writeSystemEntry keeps one per branch).
    // One value, so a failing run shows the entry and the runs in one diff.
    await expect
      .poll(
        async () => ({ entries: await systemEntries(page, branchId), runs: await closeRuns(page) }),
        {
          timeout: 15_000,
        },
      )
      .toEqual({
        entries: [
          [
            'config-resolver',
            'tool-calling-off',
            'lore-mgmt',
            'failed',
            pick.id,
            t('reader:systemEntry.failure.closeToolCallingOff', { model: SEEDED_MODEL }),
          ],
        ],
        runs: [],
      })
    // raiseSystemEntry patched the loaded branch: the reader shows the entry without a reload.
    await expect(reader.retrySystemEntry(page)).toBeVisible()
    expect(hero().mock.requests.length, 'the confirm reached no provider').toBe(sent)
    expect(await chapterCount(page, branchId)).toBe(chaptersBefore)

    // The Retry restarts the click's pick, not an owed close (there is none: "Nothing left to
    // close"), so with the flag still off it fails the same pre-flight into a fresh entry that
    // keeps the pick.
    const [{ id: firstEntryId }] = await systemEntryIds(page, branchId)
    await reader.retrySystemEntry(page).click()
    await expect
      .poll(
        async () => {
          const [entry] = await systemEntryIds(page, branchId)
          return entry?.id !== firstEntryId
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    expect(await systemEntries(page, branchId), 'the Retry kept the pick and the failure').toEqual([
      [
        'config-resolver',
        'tool-calling-off',
        'lore-mgmt',
        'failed',
        pick.id,
        t('reader:systemEntry.failure.closeToolCallingOff', { model: SEEDED_MODEL }),
      ],
    ])
    expect(await closeRuns(page), 'the Retry started no close run').toEqual([])
    expect(hero().mock.requests.length, 'the Retry reached no provider').toBe(sent)
    expect(await chapterCount(page, branchId)).toBe(chaptersBefore)
  })
})
