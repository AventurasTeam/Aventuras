import { expect, test, type Page } from '@playwright/test'

import type { CloseReport } from '@/lib/db'

import { goToChapterTimeline, openStory } from '../flows/navigation'
import { currentBranchId, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { suppressNativeUnloadDialogRace } from '../harness/reload'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'
import { chapterTimeline } from '../locators/chapter-timeline'
import { chrome } from '../locators/chrome'
import { reader } from '../locators/reader'
import { reviewWindow } from '../locators/review-window'
import { saveSession } from '../locators/save-session'
import { world } from '../locators/world'

const HERO_STORY = 'story_hero'
const HERO_TITLE = 'The Veilstone Courier'
// By title, never by position (milestone C8): the seeded close with a report, and the one without.
const REVIEWED = 'The Keep Leans Closer'
const UNREVIEWED = 'Nine Days of Rain'
const DRAFT = 'E2E dirty review draft'
// The seeded report's one skipped write (lib/db/devtools/seed-dataset.ts).
const NOT_APPLIED = 1

type Chapter = { id: string; number: number }
type Change = { name: string; entryId: string; position: number }

// Serial suite, one shared app: test 1 ends in World over the Timeline over the reader, test 2 in
// World again; each later test goes back to the reader first, which pops what's above it.
test.describe.serial('Chapter review', () => {
  let app: LaunchedApp
  let userDataDir: string
  let branchId: string
  let reviewed: Chapter
  let change: Change
  let stopped: CloseReport['stopped'][number]

  test.beforeAll(async () => {
    ;({ userDataDir } = createSeededUserDataDir())
    app = await launchApp({ userDataDir, cleanupUserData: true })
    suppressNativeUnloadDialogRace(app)
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  // A renamed chapter throws: an undefined id would scope every card locator to nothing.
  async function chapterByTitle(page: Page, title: string): Promise<Chapter> {
    const rows = await queryApp(
      page,
      `SELECT id, sequence_number FROM chapters WHERE branch_id = ? AND title = ?`,
      [branchId, title],
    )
    if (rows.length !== 1) throw new Error(`expected one chapter titled ${title}: ${rows.length}`)
    const [id, number] = rows[0]
    return { id: id as string, number: number as number }
  }

  async function reportOf(page: Page, chapterId: string): Promise<CloseReport> {
    const [[json]] = await queryApp(
      page,
      `SELECT close_report FROM chapters WHERE branch_id = ? AND id = ?`,
      [branchId, chapterId],
    )
    if (typeof json !== 'string') throw new Error(`chapter ${chapterId} holds no close report`)
    return JSON.parse(json) as CloseReport
  }

  // The landed write's row and its latest cited entry, as the review picks them (C4: from turns).
  async function landedChange(page: Page, report: CloseReport): Promise<Change> {
    const landed = report.calls.filter((call) => call.result === 'ok')
    if (landed.length !== 1) throw new Error(`expected one landed call: ${landed.length}`)
    const [call] = landed
    if (call.turns.length === 0) throw new Error('the landed call cites no entry')
    const cited = await queryApp(
      page,
      `SELECT id, position FROM story_entries
       WHERE branch_id = ? AND id IN (${call.turns.map(() => '?').join(', ')})
       ORDER BY position DESC LIMIT 1`,
      [branchId, ...call.turns],
    )
    if (cited.length === 0) throw new Error(`no cited entry is on the branch: ${call.turns}`)
    const [[entryId, position]] = cited
    return { name: call.rows[0].name, entryId: entryId as string, position: position as number }
  }

  const changeRow = (page: Page) =>
    reviewWindow.row(page, t('history:rowLabel', { op: t('history:op.update'), name: change.name }))

  // GO TO pops back to the reader, so a Timeline opened after it starts with every card collapsed.
  async function backToReader(page: Page): Promise<void> {
    await chrome.actionsTrigger(page).click()
    await chrome.goToReaderRow(page).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reader.composer(page)).toBeVisible()
  }

  async function openReview(page: Page): Promise<void> {
    await chapterTimeline.cardHead(page, reviewed.id).click()
    await expect(chapterTimeline.cardHead(page, reviewed.id)).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await chapterTimeline.reviewChanges(page, reviewed.id).click()
    await expect(reviewWindow.window(page)).toBeVisible()
  }

  test('Review changes shows only where a close wrote its report, and a row press lands in World', async () => {
    const page = app.window
    await openStory(page, HERO_TITLE)
    branchId = await currentBranchId(page, HERO_STORY)
    reviewed = await chapterByTitle(page, REVIEWED)
    const unreviewed = await chapterByTitle(page, UNREVIEWED)
    const report = await reportOf(page, reviewed.id)
    change = await landedChange(page, report)
    stopped = report.stopped[0]
    expect(stopped?.part, 'the seeded stop names its part').toBeGreaterThan(0)

    await goToChapterTimeline(page)
    // The action row shows only on an expanded card: Jump first, or the absence proves nothing.
    await chapterTimeline.cardHead(page, unreviewed.id).click()
    await expect(chapterTimeline.jump(page, unreviewed.id)).toBeVisible()
    await expect(chapterTimeline.reviewChanges(page, unreviewed.id)).toHaveCount(0)

    await openReview(page)
    await expect(reviewWindow.window(page)).toHaveAccessibleName(
      t('chapters:review.title', { number: reviewed.number, title: REVIEWED }),
    )
    await expect(changeRow(page)).toBeVisible()
    await expect(reviewWindow.notApplied(page, NOT_APPLIED)).toBeVisible()
    await expect(
      reviewWindow.window(page).getByText(
        t('chapters:review.stopped.line', {
          task: t(`chrome.memoryBanner.closeTask.${stopped.task}`),
          part: stopped.part,
          reason: t(`chapters:review.stopped.${stopped.reason}`),
        }),
        { exact: true },
      ),
    ).toBeVisible()

    await changeRow(page).click()
    await page.waitForURL(/\/world\//)
    await expect(world.detailName(page)).toHaveText(change.name)
    await expect(reviewWindow.window(page)).toHaveCount(0)
  })

  test('over a dirty card a row press asks first: Cancel stays on the Timeline, Discard lands in World', async () => {
    const page = app.window
    await backToReader(page)
    await goToChapterTimeline(page)
    await chapterTimeline.cardHead(page, reviewed.id).click()
    await chapterTimeline.field(page, reviewed.id, 'title').fill(DRAFT)
    await chapterTimeline.reviewChanges(page, reviewed.id).click()
    await expect(reviewWindow.window(page)).toBeVisible()

    // The window closes before the guard asks, and nothing moves until it's answered.
    await changeRow(page).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await expect(reviewWindow.mounted(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chapter-timeline\//)

    await saveSession.unsavedCancel(page).click()
    await expect(saveSession.unsavedDialog(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/chapter-timeline\//)
    await expect(reviewWindow.window(page)).toHaveCount(0)
    await expect(chapterTimeline.field(page, reviewed.id, 'title')).toHaveValue(DRAFT)

    await chapterTimeline.reviewChanges(page, reviewed.id).click()
    await changeRow(page).click()
    await expect(saveSession.unsavedDialog(page)).toBeVisible()
    await saveSession.unsavedDiscard(page).click()
    await page.waitForURL(/\/world\//)
    await expect(world.detailName(page)).toHaveText(change.name)
    expect(
      await queryApp(page, `SELECT title FROM chapters WHERE branch_id = ? AND id = ?`, [
        branchId,
        reviewed.id,
      ]),
    ).toEqual([[REVIEWED]])
  })

  test('the entry link lands the reader on the cited entry', async () => {
    const page = app.window
    await backToReader(page)
    // The reader still sits at its tail, well past the chapter's cited entry.
    await expect(reader.row(page, change.entryId)).not.toBeInViewport()
    await goToChapterTimeline(page)
    await openReview(page)

    await reviewWindow.entryLink(page, t('entryRef', { n: change.position })).click()
    await page.waitForURL(/\/reader-composer\//)
    await expect(reviewWindow.window(page)).toHaveCount(0)
    await expect(reader.row(page, change.entryId)).toBeInViewport({ timeout: 20_000 })
  })
})
