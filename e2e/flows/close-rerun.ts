import { expect, type Page } from '@playwright/test'

import { queryApp } from '../harness/db'
import type { MockLlm } from '../harness/mock-llm'
import { chapterTimeline } from '../locators/chapter-timeline'

/** memory/chapter-close.md → Run order: Lore's tools key its lane; every other lane ends its task. */
export const LORE_TOOLS = ['read_row', 'create_lore', 'update_lore'] as const

/** A re-run makes no call in boundary or metadata (M5 C2): neither lane is asked. */
export const UNASKED_LANES: readonly string[] = ['chapter-boundary', 'chapter-metadata']

const call = (name: string, args: Record<string, unknown>) => ({ toolCalls: [{ name, args }] })

/** `setToolSteps` replaces the lane's queue, so each re-run scripts its own write. */
export function scriptRerunLore(mock: MockLlm, lore: { title: string; body: string }): void {
  mock.setToolSteps(LORE_TOOLS, [
    call('create_lore', { ...lore, turns: ['t1'], why: 'The chapter’s first turn sets it out.' }),
  ])
}

/** The story's chapter-close runs, oldest first: [actionId, outcome]. */
export async function closeRunsOf(page: Page, storyId: string): Promise<[string, string | null][]> {
  const rows = await queryApp(
    page,
    `SELECT action_id, outcome FROM pipeline_runs
      WHERE kind = 'chapter-close' AND story_id = ? ORDER BY started_at, rowid`,
    [storyId],
  )
  return rows.map(([actionId, outcome]) => [actionId as string, outcome as string | null])
}

/**
 * Polls until the one run after `before` finishes; asserts it committed and isn't `closeAction`;
 * returns its action.
 */
export async function committedRerunAfter(
  page: Page,
  storyId: string,
  before: number,
  closeAction: string,
): Promise<string> {
  await expect
    .poll(async () => (await closeRunsOf(page, storyId)).slice(before), {
      timeout: 120_000,
      message: 'the re-run never finished',
    })
    .toEqual([[expect.any(String), expect.any(String)]])
  const [[actionId, outcome]] = (await closeRunsOf(page, storyId)).slice(before)
  expect(outcome, 'the re-run committed').toBe('completed')
  expect(actionId).not.toBe(closeAction)
  return actionId
}

/** The chapter's close report action on the branch. */
export async function closeReportAction(
  page: Page,
  branchId: string,
  chapterId: string,
): Promise<unknown> {
  const rows = await queryApp(
    page,
    `SELECT json_extract(close_report, '$.actionId') FROM chapters WHERE branch_id = ? AND id = ?`,
    [branchId, chapterId],
  )
  return rows[0]?.[0]
}

/** The actions whose deltas created the lore titled `title` on the branch. */
export function loreCreateActions(
  page: Page,
  branchId: string,
  title: string,
): Promise<unknown[][]> {
  return queryApp(
    page,
    `SELECT d.action_id FROM deltas d
       JOIN lore l ON l.branch_id = d.branch_id AND l.id = d.target_id
      WHERE d.branch_id = ? AND l.title = ? AND d.op = 'create'`,
    [branchId, title],
  )
}

/** Expands the chapter's Timeline card; a click on an already expanded head would collapse it. */
export async function expandChapterCard(page: Page, chapterId: string): Promise<void> {
  const head = chapterTimeline.cardHead(page, chapterId)
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
}
