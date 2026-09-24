/**
 * Turning a reconciliation into the writes that commit with it.
 *
 * Reconciling is not only entry times: chapter spans covering those entries are copies that go
 * stale, a delta's recorded clock would otherwise restore an earlier value on rollback, and a
 * range reaching the end of the branch moves the story clock. All of it lands together or
 * not at all.
 */

import type { Chapter, Checkpoint, StoryEntry, TimeTracker, WorldStateDelta } from '$lib/types'
import type { ReconciledTime } from './reconcile'
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

export interface CheckpointClockUpdate {
  checkpointId: string
  timeTracker: TimeTracker
}

export interface ReconciliationPlan {
  times: ReconciledTime[]
  chapterSpans: ChapterSpanUpdate[]
  deltas: DeltaUpdate[]
  /**
   * The story clock afterwards, or null to leave it alone.
   *
   * Only a range that reaches the branch's last entry moves it. An interior range makes no
   * claim about where the story now stands, and writing the clock anyway would discard a
   * clock-only adjustment the reader had not yet committed by continuing the story.
   */
  clock: TimeTracker | null
  /**
   * Checkpoints taken at a rewritten entry, reseeded with that entry's new ending.
   *
   * A checkpoint holds the clock a branch forked there will be seeded with, read at the fork
   * rather than at the range, so leaving it would open that branch on the old time.
   */
  checkpointClocks: CheckpointClockUpdate[]
  /**
   * Entries whose automatic world-state keyframes this reconciliation invalidates.
   *
   * A keyframe is a cache taken wherever the snapshot interval fell, so it can be neither
   * pinned nor rewritten with confidence, and is discarded the way a rollback discards it.
   */
  keyframeEntryIds: string[]
}

export interface PlanReconciliationInput {
  /** Every entry on the branch, in story order. */
  entries: StoryEntry[]
  chapters: Chapter[]
  /** The reconciliation's output for the entries inside the range. */
  times: ReconciledTime[]
  checkpoints?: Checkpoint[]
}

export function planReconciliation(input: PlanReconciliationInput): ReconciliationPlan {
  const { entries, chapters, times, checkpoints = [] } = input
  const reconciled = new Map(times.map((time) => [time.entryId, time]))

  const startOf = (entry: StoryEntry) =>
    reconciled.get(entry.id)?.start ?? entry.metadata?.timeStart ?? null
  const endOf = (entry: StoryEntry) =>
    reconciled.get(entry.id)?.end ?? entry.metadata?.timeEnd ?? null

  const indexById = new Map(entries.map((entry, index) => [entry.id, index]))
  const reconciledIndices = times
    .map((time) => indexById.get(time.entryId))
    .filter((index): index is number => index !== undefined)
  const firstReconciled = Math.min(...reconciledIndices)
  const lastReconciled = Math.max(...reconciledIndices)

  const chapterSpans: ChapterSpanUpdate[] = []
  for (const chapter of chapters) {
    const from = indexById.get(chapter.startEntryId)
    const to = indexById.get(chapter.endEntryId)
    if (from === undefined || to === undefined) continue
    if (to < firstReconciled || from > lastReconciled) continue

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

  const reachesEnd = lastReconciled === entries.length - 1
  const clock = reachesEnd ? (times[times.length - 1]?.end ?? null) : null

  // A checkpoint's clock is a copy of the ending of the entry it was taken at, so every rewritten
  // entry takes its checkpoints with it. A copy left behind is what a branch forked there opens on.
  const checkpointClocks: CheckpointClockUpdate[] = checkpoints
    .filter((checkpoint) => reconciled.has(checkpoint.lastEntryId))
    .map((checkpoint) => ({
      checkpointId: checkpoint.id,
      timeTracker: reconciled.get(checkpoint.lastEntryId)!.end,
    }))

  return {
    times,
    chapterSpans,
    deltas,
    clock,
    checkpointClocks,
    keyframeEntryIds: times.map((time) => time.entryId),
  }
}

/**
 * What a preview was computed from.
 *
 * Compared before applying, so generation, a deletion, an anchor edit or a branch switch
 * cannot land a reconciliation against figures that have moved. The boundary ids inside the range are
 * part of it: a boundary appearing there makes the selection invalid even though both endpoints
 * still resolve unchanged, because a range may not span one.
 */
export function fingerprintPreview(input: {
  storyId: string
  branchId: string | null
  from: Boundary
  to: Boundary
  rangeEntries: StoryEntry[]
  boundaryEntryIds: string[]
}): string {
  const { storyId, branchId, from, to, rangeEntries, boundaryEntryIds } = input
  const stamp = (time: TimeTracker | null) => (time ? String(toMinutes(time)) : 'none')
  const inRange = new Set(rangeEntries.map((entry) => entry.id))

  return JSON.stringify({
    storyId,
    branchId,
    from: [from.entryId, stamp(from.time)],
    to: [to.entryId, stamp(to.time)],
    entries: rangeEntries.map((entry) => [entry.id, stamp(entry.metadata?.timeEnd ?? null)]),
    // Excludes the later boundary, which is a boundary by definition: it bounds the range
    // rather than sitting inside it.
    boundariesInside: boundaryEntryIds.filter((id) => inRange.has(id) && id !== to.entryId).sort(),
  })
}

export interface ReconciliationWriteDeps {
  /** Runs every statement as one unit, or none of them. */
  transaction: (statements: { sql: string; params?: unknown[] }[]) => Promise<unknown>
  /** In-memory state, published only after the commit succeeds. */
  publish: (plan: ReconciliationPlan) => void
}

/** The statements a plan writes, in the order they are applied. */
export function reconciliationStatements(
  plan: ReconciliationPlan,
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

  for (const update of plan.checkpointClocks) {
    statements.push({
      sql: 'UPDATE checkpoints SET time_tracker_snapshot = ? WHERE id = ?',
      params: [JSON.stringify(update.timeTracker), update.checkpointId],
    })
  }

  // Chunked like the database service's deletes, to stay under SQLite's bound-parameter limit.
  for (let i = 0; i < plan.keyframeEntryIds.length; i += 500) {
    const slice = plan.keyframeEntryIds.slice(i, i + 500)
    statements.push({
      sql: `DELETE FROM world_state_snapshots WHERE entry_id IN (${slice.map(() => '?').join(', ')})`,
      params: slice,
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
export async function applyReconciliation(
  plan: ReconciliationPlan,
  entries: StoryEntry[],
  deps: ReconciliationWriteDeps,
): Promise<void> {
  await deps.transaction(reconciliationStatements(plan, entries))
  deps.publish(plan)
}
