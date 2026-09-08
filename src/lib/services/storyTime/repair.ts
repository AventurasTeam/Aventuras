/**
 * Turning a reconciliation into the writes that commit with it.
 *
 * A repair is not only entry times: chapter spans covering those entries are copies that go
 * stale, a delta's recorded clock would otherwise restore a pre-repair value on rollback, and
 * a repair reaching the end of the branch moves the story clock. All of it lands together or
 * not at all.
 */

import type { Chapter, StoryEntry, TimeTracker, WorldStateDelta } from '$lib/types'
import type { RepairedTime } from './reconcile'
import type { Boundary } from './boundaries'
import { toMinutes } from './minutes'

export interface ChapterSpanUpdate {
  chapterId: string
  startTime: TimeTracker | null
  endTime: TimeTracker | null
}

export interface DeltaUpdate {
  entryId: string
  delta: WorldStateDelta
}

export interface RepairPlan {
  times: RepairedTime[]
  chapterSpans: ChapterSpanUpdate[]
  deltas: DeltaUpdate[]
  /**
   * The story clock after the repair, or null to leave it alone.
   *
   * Only a repair that reaches the branch's last entry moves it. An interior repair makes no
   * claim about where the story now stands, and writing the clock anyway would discard a
   * clock-only adjustment the reader had not yet committed by continuing the story.
   */
  clock: TimeTracker | null
}

export interface PlanRepairInput {
  /** Every entry on the branch, in story order. */
  entries: StoryEntry[]
  chapters: Chapter[]
  /** The reconciliation's output for the entries inside the range. */
  times: RepairedTime[]
}

export function planRepair(input: PlanRepairInput): RepairPlan {
  const { entries, chapters, times } = input
  const repaired = new Map(times.map((time) => [time.entryId, time]))

  const startOf = (entry: StoryEntry) =>
    repaired.get(entry.id)?.start ?? entry.metadata?.timeStart ?? null
  const endOf = (entry: StoryEntry) =>
    repaired.get(entry.id)?.end ?? entry.metadata?.timeEnd ?? null

  const indexById = new Map(entries.map((entry, index) => [entry.id, index]))
  const repairedIndices = times
    .map((time) => indexById.get(time.entryId))
    .filter((index): index is number => index !== undefined)
  const firstRepaired = Math.min(...repairedIndices)
  const lastRepaired = Math.max(...repairedIndices)

  const chapterSpans: ChapterSpanUpdate[] = []
  for (const chapter of chapters) {
    const from = indexById.get(chapter.startEntryId)
    const to = indexById.get(chapter.endEntryId)
    if (from === undefined || to === undefined) continue
    if (to < firstRepaired || from > lastRepaired) continue

    chapterSpans.push({
      chapterId: chapter.id,
      startTime: startOf(entries[from]),
      endTime: endOf(entries[to]),
    })
  }

  // A delta records the clock as it stood before its entry was classified, which is that
  // entry's beginning. Everything else in the delta is left exactly as it was.
  const deltas: DeltaUpdate[] = []
  for (const time of times) {
    const entry = entries[indexById.get(time.entryId) ?? -1]
    if (!entry?.worldStateDelta) continue
    deltas.push({
      entryId: entry.id,
      delta: {
        ...entry.worldStateDelta,
        previousState: { ...entry.worldStateDelta.previousState, timeTracker: time.start },
      },
    })
  }

  const reachesEnd = lastRepaired === entries.length - 1
  const clock = reachesEnd ? (times[times.length - 1]?.end ?? null) : null

  return { times, chapterSpans, deltas, clock }
}

/**
 * What a preview was computed from.
 *
 * Compared before applying, so generation, a deletion, an anchor edit or a branch switch
 * cannot land a repair against figures that have moved. The anchored ids inside the range are
 * part of it: an anchor added there makes the selection invalid even though both endpoints
 * still resolve unchanged, because a range may not span an anchor.
 */
export function fingerprintPreview(input: {
  storyId: string
  branchId: string | null
  from: Boundary
  to: Boundary
  rangeEntries: StoryEntry[]
  anchoredEntryIds: string[]
}): string {
  const { storyId, branchId, from, to, rangeEntries, anchoredEntryIds } = input
  const stamp = (time: TimeTracker | null) => (time ? String(toMinutes(time)) : 'none')
  const inRange = new Set(rangeEntries.map((entry) => entry.id))

  return JSON.stringify({
    storyId,
    branchId,
    from: [from.entryId, stamp(from.time)],
    to: [to.entryId, stamp(to.time)],
    entries: rangeEntries.map((entry) => [entry.id, stamp(entry.metadata?.timeEnd ?? null)]),
    // Excludes the later boundary, which is allowed to be anchored: it bounds the range
    // rather than sitting inside it.
    anchoredInside: anchoredEntryIds.filter((id) => inRange.has(id) && id !== to.entryId).sort(),
  })
}

export interface RepairWriteDeps {
  /** Runs every statement as one unit, or none of them. */
  transaction: (statements: { sql: string; params?: unknown[] }[]) => Promise<unknown>
  /** In-memory state, published only after the commit succeeds. */
  publish: (plan: RepairPlan) => void
}

/** The statements a plan writes, in the order they are applied. */
export function repairStatements(
  plan: RepairPlan,
  entries: StoryEntry[],
): { sql: string; params?: unknown[] }[] {
  const metadataById = new Map(entries.map((entry) => [entry.id, entry.metadata ?? {}]))
  const statements: { sql: string; params?: unknown[] }[] = []

  for (const time of plan.times) {
    const metadata = { ...metadataById.get(time.entryId), timeStart: time.start, timeEnd: time.end }
    statements.push({
      sql: 'UPDATE story_entries SET metadata = ? WHERE id = ?',
      params: [JSON.stringify(metadata), time.entryId],
    })
  }

  for (const span of plan.chapterSpans) {
    statements.push({
      sql: 'UPDATE chapters SET start_time = ?, end_time = ? WHERE id = ?',
      params: [
        span.startTime ? JSON.stringify(span.startTime) : null,
        span.endTime ? JSON.stringify(span.endTime) : null,
        span.chapterId,
      ],
    })
  }

  for (const delta of plan.deltas) {
    statements.push({
      sql: 'UPDATE story_entries SET world_state_delta = ? WHERE id = ?',
      params: [JSON.stringify(delta.delta), delta.entryId],
    })
  }

  if (plan.clock) {
    statements.push({
      sql: 'UPDATE stories SET time_tracker = ? WHERE id = (SELECT story_id FROM story_entries WHERE id = ?)',
      params: [JSON.stringify(plan.clock), plan.times[plan.times.length - 1].entryId],
    })
  }

  return statements
}

/** Commit a plan. Nothing is published unless every statement lands. */
export async function applyRepair(
  plan: RepairPlan,
  entries: StoryEntry[],
  deps: RepairWriteDeps,
): Promise<void> {
  await deps.transaction(repairStatements(plan, entries))
  deps.publish(plan)
}
