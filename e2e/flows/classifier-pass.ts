import { expect, type Locator, type Page } from '@playwright/test'

import { currentBranchId, entryIdOf, pollEntryIdOf, queryApp } from '../harness/db'
import { t } from '../harness/i18n'
import { type MockLlm } from '../harness/mock-llm'
import { reader } from '../locators/reader'
import { toast } from '../locators/toast'

// A pass that writes one happening, so its run leaves deltas to find by action_id.
export function gatedPassReply(title: string) {
  return {
    happenings: [{ title, description: 'E2E gated pass.', sourceTurn: 't1' }],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
    newFactions: [],
    memberships: [],
  }
}

// A story's runs of one kind, oldest first, by outcome; pipeline_runs has no branch column.
export async function runOutcomes(
  page: Page,
  kind: string,
  storyId: string,
): Promise<(string | null)[]> {
  const rows = await queryApp(
    page,
    `SELECT outcome FROM pipeline_runs WHERE kind = ? AND story_id = ? ORDER BY started_at, rowid`,
    [kind, storyId],
  )
  return rows.map((r) => r[0] as string | null)
}

// The action id of the one run of `kind` in flight, once its call reached the mock past
// `callsBefore`.
export async function heldRun(
  page: Page,
  run: { kind: string; storyId: string; calls: () => number },
  callsBefore: number,
): Promise<string> {
  await expect.poll(run.calls, { timeout: 30_000 }).toBeGreaterThan(callsBefore)
  const rows = await queryApp(
    page,
    `SELECT action_id FROM pipeline_runs WHERE kind = ? AND story_id = ? AND finished_at IS NULL`,
    [run.kind, run.storyId],
  )
  expect(rows, `one ${run.kind} in flight`).toHaveLength(1)
  return rows[0][0] as string
}

// The run, status and entry reads the pass describes share. Getters, since each describe's
// beforeAll assigns its app and mock after this runs.
export function passProbe(page: () => Page, mockLlm: () => MockLlm) {
  function branchId(): Promise<string> {
    return currentBranchId(page(), 'story_hero')
  }

  const entryIdByContent = (branch: string, marker: string) => entryIdOf(page(), branch, marker)
  const pollEntryId = (branch: string, marker: string) => pollEntryIdOf(page(), branch, marker)

  async function createDelta(
    branch: string,
    entryId: string,
  ): Promise<{ actionId: string; logPosition: number }> {
    const rows = await queryApp(
      page(),
      `SELECT action_id, log_position FROM deltas WHERE branch_id = ? AND target_table = 'story_entries'
         AND op = 'create' AND target_id = ?`,
      [branch, entryId],
    )
    expect(rows.length, `create delta for entry ${entryId}`).toBe(1)
    return { actionId: rows[0][0] as string, logPosition: rows[0][1] as number }
  }

  const passOutcomes = () => runOutcomes(page(), 'periodic-classifier', 'story_hero')

  async function runOutcome(actionId: string): Promise<string | null> {
    const rows = await queryApp(page(), `SELECT outcome FROM pipeline_runs WHERE action_id = ?`, [
      actionId,
    ])
    return rows[0][0] as string | null
  }

  async function passDeltas(actionId: string): Promise<{ count: number; last: number | null }> {
    const rows = await queryApp(
      page(),
      `SELECT COUNT(*), MAX(log_position) FROM deltas WHERE action_id = ?`,
      [actionId],
    )
    return { count: rows[0][0] as number, last: rows[0][1] as number | null }
  }

  async function classifierStatus(branch: string): Promise<unknown[]> {
    return (
      await queryApp(
        page(),
        `SELECT json_extract(classifier_status, '$.state'),
                json_extract(classifier_status, '$.lastError'),
                json_extract(classifier_status, '$.processedThrough')
         FROM branches WHERE id = ?`,
        [branch],
      )
    )[0]
  }

  const passCalls = (): number =>
    mockLlm().requests.filter((r) => r.agent === 'periodic-classifier').length

  const heldPass = (callsBefore: number) =>
    heldRun(
      page(),
      { kind: 'periodic-classifier', storyId: 'story_hero', calls: passCalls },
      callsBefore,
    )

  async function send(action: string, reply: string): Promise<void> {
    mockLlm().setNarrative(reply)
    await reader.composer(page()).fill(action)
    await reader.send(page()).click()
  }

  const deferralToast = (): Locator => toast.withText(page(), t('chrome.deferredWork.pass'))

  return {
    branchId,
    entryIdByContent,
    pollEntryId,
    createDelta,
    passOutcomes,
    runOutcome,
    passDeltas,
    classifierStatus,
    passCalls,
    heldPass,
    send,
    deferralToast,
  }
}
