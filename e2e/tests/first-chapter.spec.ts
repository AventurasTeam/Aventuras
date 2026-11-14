import { expect, test } from '@playwright/test'

import { vecTableName } from '@/lib/db'

import { takeTurn } from '../flows/turn'
import {
  branchStaleTotal,
  currentBranchId,
  queryApp,
  queryScalar,
  OPEN_REGION_FROM,
} from '../harness/db'
import { installEmbedderModel } from '../harness/embedder'
import { t } from '../harness/i18n'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { promptOf, startMockLlm, type MockLlm } from '../harness/mock-llm'
import { createSeededUserDataDir, removeUserDataDir, setProviderEndpoint } from '../harness/seed'
import { devChapterClose } from '../locators/dev-chapter-close'
import { memoryBanner } from '../locators/memory-banner'
import { plot } from '../locators/plot'
import { reader } from '../locators/reader'
import { reviewWindow } from '../locators/review-window'

const HERO_STORY = 'story_hero'
const PACT = 'Vorne’s pact'
// A reply past the pact's anchor (entry 59), with open entries left after it.
const END_POSITION = 63
const CHAPTER = {
  title: 'The Pact at the Keep Gate',
  summary: 'Kael takes Vorne’s pact of safe passage and carries the amulet to the keep gate.',
  theme: 'bargains under pressure',
  keywords: ['pact', 'keep', 'passage', 'amulet'],
}
// Worded like the summary, so the chapter clears the ranker's score floor on this turn.
const ACTION = 'I carry the amulet to the keep gate under Vorne’s pact of safe passage.'
const REPLY_MARKER = 'E2E-FIRSTCHAPTER-REPLY'
const REPLY = `${REPLY_MARKER} the gate-warden reads the pact and lifts the bar.`

type OpenRow = [id: string, position: number, kind: string]

// One total order for both sides of the reset comparison.
const byBinary = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Reached by URL (docs/testing.md → Harness structure): no in-app path leads here under E2E, as
// Settings renders its /dev link only under __DEV__ (app/settings/index.tsx), false in both launch
// modes; the route is the close's only start until the real starts replace it (Slice 5.10).
test.describe('first chapter — a close from the dev route', () => {
  let app: LaunchedApp
  let mock: MockLlm
  let userDataDir: string | undefined
  let embedder: { modelId: string; dim: number }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    const seeded = createSeededUserDataDir()
    userDataDir = seeded.userDataDir
    embedder = await installEmbedderModel(userDataDir)
    mock = await startMockLlm()
    mock.setStructured('chapter-metadata', CHAPTER)
    mock.setNarrative(REPLY)
    setProviderEndpoint(seeded.dbPath, mock.url)
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    await mock?.close()
    removeUserDataDir(userDataDir)
  })

  test('a close at a reply lands, files the pact under Earlier chapters, embeds and reaches the next prompt', async () => {
    // The drain embeds every seeded stale row of the branch before the chapter's vector is asserted.
    test.setTimeout(300_000)
    const page = app.window
    const branchId = await currentBranchId(page, HERO_STORY)
    const openRows = (await queryApp(
      page,
      `SELECT id, position, kind ${OPEN_REGION_FROM} ORDER BY position`,
      [branchId],
    )) as OpenRow[]
    const range = openRows.filter(([, position]) => position <= END_POSITION)
    const end = range.at(-1)
    expect(end?.slice(1), 'the end is an open-region reply').toEqual([END_POSITION, 'ai_reply'])
    const endId = end![0]
    expect(openRows.length, 'entries stay open past the end').toBeGreaterThan(range.length)
    const pactPosition = await queryScalar(
      page,
      `SELECT e.position FROM happenings h
       JOIN story_entries e ON e.branch_id = h.branch_id AND e.id = h.occurred_at_entry_id
       WHERE h.branch_id = ? AND h.title = ?`,
      [branchId, PACT],
    )
    expect(
      range.map(([, position]) => position),
      'the pact’s anchor closes with the chapter',
    ).toContain(pactPosition)
    const chaptersBefore = await queryScalar(
      page,
      `SELECT COUNT(*) FROM chapters WHERE branch_id = ?`,
      [branchId],
    )
    const logHead = await queryScalar(
      page,
      `SELECT COALESCE(MAX(log_position), 0) FROM deltas WHERE branch_id = ?`,
      [branchId],
    )
    // The close's code steps: the reset updates every counted row, normalization every folded record.
    const counted = (
      (await queryApp(
        page,
        `SELECT id FROM happening_awareness WHERE branch_id = ? AND retrieval_count > 0`,
        [branchId],
      )) as [string][]
    )
      .map(([id]) => id)
      .toSorted(byBinary)
    expect(counted.length, 'the seed counts retrievals for the reset to clear').toBeGreaterThan(0)
    expect(
      await queryScalar(
        page,
        `SELECT COUNT(*) FROM entities WHERE branch_id = ? AND kind = 'character'
         AND json_extract(state, '$.stackables') IS NOT NULL
         AND json_extract(state, '$.stackables') <> '{}'`,
        [branchId],
      ),
      'no character holds stackables, so normalization writes nothing',
    ).toBe(0)

    const { actionId, chapterId } =
      await test.step('the dev route closes at the reply', async () => {
        await page.goto(
          new URL(
            `/dev/chapter-close?branchId=${encodeURIComponent(branchId)}`,
            page.url(),
          ).toString(),
        )
        await expect(devChapterClose.closeAt(page, END_POSITION)).toBeVisible({ timeout: 30_000 })
        // The drain re-runs on run_complete only when idle, so a close during a pass is never embedded.
        await expect
          .poll(() => branchStaleTotal(page, branchId), {
            timeout: 120_000,
            message: 'the open-time drain never went quiet',
          })
          .toBe(0)
        await devChapterClose.closeAt(page, END_POSITION).click()
        await expect
          .poll(
            async () =>
              (
                await queryApp(
                  page,
                  `SELECT outcome FROM pipeline_runs WHERE kind = 'chapter-close' AND story_id = ?`,
                  [HERO_STORY],
                )
              ).flat(),
            { timeout: 30_000, message: 'the close run did not complete' },
          )
          .toEqual(['completed'])
        await expect(devChapterClose.result(page)).toContainText('completed')
        const runs = (await queryApp(
          page,
          `SELECT action_id FROM pipeline_runs WHERE kind = 'chapter-close' AND story_id = ?`,
          [HERO_STORY],
        )) as [string][]
        const rows = (await queryApp(
          page,
          `SELECT id FROM chapters WHERE branch_id = ? AND sequence_number = ?`,
          [branchId, chaptersBefore + 1],
        )) as [string][]
        expect(rows, 'one chapter numbered after the seeded ones').toHaveLength(1)
        return { actionId: runs[0]![0], chapterId: rows[0]![0] }
      })

    await test.step('the row, its stamps and one action’s deltas land (DB first)', async () => {
      const [row] = (await queryApp(
        page,
        `SELECT sequence_number, start_entry_id, end_entry_id, title, summary, theme, keywords,
                token_count, close_report
         FROM chapters WHERE branch_id = ? AND id = ?`,
        [branchId, chapterId],
      )) as [number, string, string, string, string, string, string, number, string][]
      const [sequence, startId, endEntryId, title, summary, theme, keywords, tokenCount, report] =
        row!
      expect({ sequence, startId, endEntryId }).toEqual({
        sequence: chaptersBefore + 1,
        startId: range[0]![0],
        endEntryId: endId,
      })
      expect({ title, summary, theme, keywords: JSON.parse(keywords) as unknown }).toEqual(CHAPTER)
      expect(JSON.parse(report) as unknown, 'a close whose tasks called no tool').toEqual({
        version: 1,
        actionId,
        calls: [],
        stopped: [],
        noToolCalls: true,
      })
      expect(tokenCount).toBeGreaterThan(0)
      expect(tokenCount, 'token_count sums the stamped range').toBe(
        await queryScalar(
          page,
          `SELECT SUM(content_tokens) FROM story_entries WHERE branch_id = ? AND chapter_id = ?`,
          [branchId, chapterId],
        ),
      )

      const stamps = await queryApp(
        page,
        `SELECT id, chapter_id FROM story_entries
         WHERE branch_id = ? AND id IN (${openRows.map(() => '?').join(', ')}) ORDER BY position`,
        [branchId, ...openRows.map(([id]) => id)],
      )
      expect(stamps, 'entries through the end stamped, those past it open').toEqual(
        openRows.map(([id, position]) => [id, position <= END_POSITION ? chapterId : null]),
      )

      const deltas = await queryApp(
        page,
        `SELECT target_table, op, target_id, entry_id, source FROM deltas
         WHERE branch_id = ? AND action_id = ? ORDER BY log_position`,
        [branchId, actionId],
      )
      const stamped = 1 + range.length
      expect(
        deltas.slice(0, stamped),
        'C1: the create, then a stamp per entry in position order',
      ).toEqual([
        ['chapters', 'create', chapterId, endId, 'chapter_close'],
        ...range.map(([id]) => ['story_entries', 'update', id, endId, 'chapter_close']),
      ])
      // counted has no ORDER BY, and canon fixes no order for the reset: sort both sides.
      expect(
        deltas.slice(stamped, -1).toSorted((a, b) => byBinary(String(a[2]), String(b[2]))),
        'then the reset: an update of each counted awareness row',
      ).toEqual(counted.map((id) => ['happening_awareness', 'update', id, endId, 'chapter_close']))
      expect(deltas.at(-1), 'then the report').toEqual([
        'chapters',
        'update',
        chapterId,
        endId,
        'chapter_close',
      ])
      expect(
        await queryScalar(
          page,
          `SELECT COUNT(*) FROM happening_awareness WHERE branch_id = ? AND retrieval_count > 0`,
          [branchId],
        ),
        'the reset left no count',
      ).toBe(0)
      expect(
        await queryScalar(
          page,
          `SELECT COUNT(*) FROM deltas WHERE branch_id = ? AND source = 'chapter_close' AND log_position > ?`,
          [branchId, logHead],
        ),
        'no close delta outside the run’s action',
      ).toBe(deltas.length)
      expect(
        mock.requests.filter((request) => request.agent === 'chapter-metadata'),
        'one metadata call, served by its own shape',
      ).toHaveLength(1)
    })

    await test.step('Plot files the pact under Earlier chapters', async () => {
      await devChapterClose.openPlot(page).click()
      await page.waitForURL(/\/plot\//)
      await plot.segmentCell(page, 'happening').click()
      const earlier = plot.tierHeader(page, t('plot:buckets.earlier'))
      await expect(earlier).toHaveAttribute('aria-expanded', 'false')
      // Current chapter starts expanded and Earlier collapsed: a pact still filed as current shows.
      await expect(plot.row(page, PACT)).toHaveCount(0)
      await earlier.click()
      await expect(plot.row(page, PACT)).toBeVisible()
    })

    await test.step('once quiet, the chapter’s summary vector exists', async () => {
      await expect
        .poll(() => branchStaleTotal(page, branchId), {
          timeout: 120_000,
          message: 'the drain never went quiet',
        })
        .toBe(0)
      // Scoped to the model id: knnQuery filters on it, so a vector under another breaks retrieval.
      expect(
        await queryScalar(
          page,
          `SELECT count(*) FROM ${vecTableName('chapter', embedder.dim)}
           WHERE branch_id = ? AND id = ? AND model_id = ?`,
          [branchId, chapterId, embedder.modelId],
        ),
      ).toBe(1)
    })

    await test.step('the banner holds the close, and its Review opens the window', async () => {
      // Back to the dev route, the screen Plot was pushed from.
      await page.goBack()
      await devChapterClose.openReader(page).click()
      await expect(reader.composer(page)).toBeVisible({ timeout: 20_000 })
      // No task called a tool and none stopped, so the done state is the info one.
      await expect(memoryBanner.closed(page, CHAPTER.title)).toBeVisible()
      await memoryBanner.review(page).click()
      await expect(reviewWindow.window(page)).toHaveAccessibleName(
        t('chapters:review.title', { number: chaptersBefore + 1, title: CHAPTER.title }),
      )
      await expect(
        reviewWindow.window(page).getByText(t('chapters:review.noToolCalls'), { exact: true }),
      ).toBeVisible()
      await reviewWindow.done(page).click()
      await expect(reviewWindow.window(page)).toHaveCount(0)
      // Review ended the done state.
      await expect(memoryBanner.banner(page)).toHaveCount(0)
    })

    await test.step('the next turn’s prompt carries the title under Earlier chapters', async () => {
      await takeTurn(page, ACTION, REPLY_MARKER)
      const narrative = mock.requests.findLast((request) => request.streamed)
      expect(narrative, 'the turn reached the provider').toBeDefined()
      const prompt = promptOf(narrative!)
      const heading = prompt.indexOf('# Earlier chapters')
      expect(heading, 'the prompt has an Earlier chapters block').toBeGreaterThanOrEqual(0)
      expect(prompt.slice(heading).split('\n# ')[0]).toContain(CHAPTER.title)
    })
  })
})
