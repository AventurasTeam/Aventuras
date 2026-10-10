import type { StoryEntry, WorldStateHeaderRecord, WorldStateRecord } from '#lib/types/index.ts'

export type LineEntry = Pick<StoryEntry, 'id' | 'position' | 'type' | 'createdAt'>

/**
 * Whether tracking ran without interruption since `previous`, the last header on the branch
 * line, or since the story was created when there is none. Turning tracking on resets
 * `enabledSince`, so anything written before it cannot vouch.
 */
export function isContinuous(
  previous: WorldStateHeaderRecord | null,
  enabledSince: number | null,
  breakSincePrevious: boolean,
  storyCreatedAt: number,
): boolean {
  if (enabledSince === null || breakSincePrevious) return false
  if (previous === null) return storyCreatedAt >= enabledSince
  return previous.coverage === 'full' && previous.createdAt >= enabledSince
}

/** The latest entry not part of a turn still being generated. */
export function lastCompletedEntry<E extends Pick<StoryEntry, 'type'>>(
  entries: E[],
  generating: boolean,
): E | null {
  let last = entries.length - 1
  if (generating) {
    while (last >= 0 && entries[last].type !== 'user_action') last--
    last--
  }
  return last >= 0 ? entries[last] : null
}

/** The last header on the line before `position`, and whether a break follows it. */
export function lastHeaderOnLine(
  records: WorldStateRecord[],
  positions: Map<string, number>,
  position: number,
): { header: WorldStateHeaderRecord | null; breakSince: boolean } {
  const onLine = records.filter((r) => (positions.get(r.entryId) ?? Infinity) < position)
  let header: WorldStateHeaderRecord | null = null
  for (const r of onLine) {
    if (r.kind === 'header' && (!header || r.seq > header.seq)) header = r
  }
  const after = header?.seq ?? -Infinity
  const breakSince = records.some((r) => r.kind === 'break' && r.seq > after)
  return { header, breakSince }
}

export interface AnchorCandidate {
  kind: 'snapshot' | 'checkpoint' | 'live'
  id: string | null
  /** Position of the entry the state was taken at. */
  position: number
  takenAt: number
}

export type RunRefusal =
  'targetUntracked' | 'untracked' | 'interrupted' | 'classifierOnly' | 'noAnchor'

/** The first thing that breaks the tracked sequence between an entry and a full state. */
export type RunGap =
  /** A narration played without State Tracking. */
  | { cause: 'untracked'; entryId: string }
  /** A narration recorded before lorebook and manual changes were. */
  | { cause: 'classifierOnly'; entryId: string }
  /** A header written as not continuing the run before it. */
  | { cause: 'header'; entryId: string; at: number; since: number | null }
  /** An export that could not vouch for tracking since the branch's last record. */
  | { cause: 'break'; entryId: string; at: number }
  | { cause: 'trackingOff' }
  /** Tracking was turned on after the last thing it wrote, or has no start time. */
  | { cause: 'enabledAfter'; lastProofAt: number | null; enabledSince: number | null }
  /** A change belonging to the target, written after the full state was taken. */
  | { cause: 'lateChange'; entryId: string; at: number; anchorTakenAt: number }

export type RunResult =
  | { ok: true; anchor: AnchorCandidate; records: WorldStateRecord[] }
  | { ok: false; reason: RunRefusal; diagnosis?: RunDiagnosis }

/** Why a past state was refused, as the three things a rebuild needs. */
export interface RunDiagnosis {
  /** When the entry's own header was written; null when it was played untracked. */
  targetRecordedAt: number | null
  /** The nearest full state after the entry, or the one that passed. */
  anchor: AnchorCandidate | null
  /** The first break in the tracked sequence between the entry and `anchor`. */
  gap: RunGap | null
}

export interface RunQuery {
  /** Every entry on the branch line. */
  line: LineEntry[]
  /** Every record on the branch line, legacy deltas included. */
  records: WorldStateRecord[]
  /** When each automatic or closing snapshot on the branch was taken. */
  snapshotTimes: number[]
  target: number
  candidates: AnchorCandidate[]
  tracking: { on: boolean; enabledSince: number | null }
}

interface Interval {
  from: number
  to: number
  cause: RunGap
}

/**
 * Stretches of time in which a change may have been made without a record. Anything that is
 * written only while tracking is on (a record, a snapshot) proves tracking was on at that moment.
 */
function suspectIntervals(query: RunQuery): Interval[] {
  const tracked = query.records.filter((r) => r.kind !== 'header' || r.coverage === 'full')
  const proofs = [
    ...tracked.filter((r) => r.kind !== 'break').map((r) => r.createdAt),
    ...query.snapshotTimes,
  ].sort((a, b) => a - b)
  const lastProofBefore = (t: number) => {
    let found = -Infinity
    for (const p of proofs) if (p < t) found = p
    return found
  }
  const headers = tracked
    .filter((r): r is WorldStateHeaderRecord => r.kind === 'header')
    .sort((a, b) => a.createdAt - b.createdAt)

  const intervals: Interval[] = []
  for (const header of headers) {
    if (header.continuous) continue
    const since = lastProofBefore(header.createdAt)
    intervals.push({
      from: since,
      to: header.createdAt,
      cause: {
        cause: 'header',
        entryId: header.entryId,
        at: header.createdAt,
        since: Number.isFinite(since) ? since : null,
      },
    })
  }
  for (const brk of tracked.filter((r) => r.kind === 'break')) {
    const next = headers.find((h) => h.createdAt > brk.createdAt)
    intervals.push({
      from: brk.createdAt,
      to: next?.createdAt ?? Infinity,
      cause: { cause: 'break', entryId: brk.entryId, at: brk.createdAt },
    })
  }
  const lastProof = proofs.length > 0 ? proofs[proofs.length - 1] : -Infinity
  const { on, enabledSince } = query.tracking
  if (!on) intervals.push({ from: lastProof, to: Infinity, cause: { cause: 'trackingOff' } })
  else if (enabledSince === null || enabledSince > lastProof) {
    intervals.push({
      from: lastProof,
      to: enabledSince ?? Infinity,
      cause: {
        cause: 'enabledAfter',
        lastProofAt: Number.isFinite(lastProof) ? lastProof : null,
        enabledSince,
      },
    })
  }
  return intervals
}

/**
 * Picks the anchor a past state at `target` is rebuilt from, and the records to undo from it.
 * The state at an entry is the state just before the next entry on the line was created.
 */
export function resolveRun(query: RunQuery): RunResult {
  const line = [...query.line].sort((a, b) => a.position - b.position)
  const next = line.find((e) => e.position > query.target)
  const positions = new Map(line.map((e) => [e.id, e.position]))
  const positionOf = (r: WorldStateRecord) => positions.get(r.entryId) ?? -Infinity
  const intervals = suspectIntervals(query)

  const headersByEntry = new Map<string, WorldStateHeaderRecord>()
  for (const r of query.records) if (r.kind === 'header') headersByEntry.set(r.entryId, r)

  const target = line.find((e) => e.position === query.target)
  const targetHeader = target ? headersByEntry.get(target.id) : undefined
  const candidates = query.candidates
    .filter((c) => c.position >= query.target)
    .sort((a, b) => a.takenAt - b.takenAt)

  const checked = candidates.map((anchor) => ({ anchor, gap: checkAnchor(anchor) }))
  const passed = checked.find((c) => c.gap === null)
  const diagnosed = passed ?? checked[0]
  const diagnosis: RunDiagnosis = {
    targetRecordedAt: targetHeader?.createdAt ?? null,
    anchor: diagnosed?.anchor ?? null,
    gap: diagnosed?.gap ?? null,
  }

  if (!targetHeader) return { ok: false, reason: 'targetUntracked', diagnosis }
  if (!diagnosed) return { ok: false, reason: 'noAnchor', diagnosis }
  if (!passed) return { ok: false, reason: refusalFor(diagnosed.gap!), diagnosis }
  const anchor = passed.anchor
  const records = query.records.filter(
    (r) =>
      positionOf(r) > query.target &&
      positionOf(r) <= anchor.position &&
      r.createdAt <= anchor.takenAt,
  )
  return { ok: true, anchor, records }

  function checkAnchor(anchor: AnchorCandidate): RunGap | null {
    if (!next) return null
    const from = next.createdAt
    const interval = intervals.find((i) => i.from < anchor.takenAt && i.to > from)
    if (interval) return interval.cause

    for (const entry of line) {
      if (entry.position <= query.target || entry.position > anchor.position) continue
      if (entry.type !== 'narration') continue
      const header = headersByEntry.get(entry.id)
      if (!header) return { cause: 'untracked', entryId: entry.id }
      if (header.coverage === 'classifier') return { cause: 'classifierOnly', entryId: entry.id }
    }

    // A change that belongs to the target's state but came after the anchor is not in it.
    const missed = query.records.find(
      (r) => r.kind === 'change' && positionOf(r) <= query.target && r.createdAt > anchor.takenAt,
    )
    if (!missed) return null
    return {
      cause: 'lateChange',
      entryId: missed.entryId,
      at: missed.createdAt,
      anchorTakenAt: anchor.takenAt,
    }
  }
}

function refusalFor(gap: RunGap): RunRefusal {
  if (gap.cause === 'untracked' || gap.cause === 'classifierOnly') return gap.cause
  return 'interrupted'
}

/** How a refused past state is built anyway, at the reader's request. */
export type GapOverride = 'undoRecorded' | 'nextAsIs' | 'previousAsIs'

/**
 * A past state built in spite of a refusal: from the nearest full state after `target`, undoing
 * only what was recorded, or from the nearest full state on either side, taken unchanged.
 */
export function resolveOverride(query: RunQuery, override: GapOverride): RunResult {
  const positions = new Map(query.line.map((e) => [e.id, e.position]))
  const positionOf = (r: WorldStateRecord) => positions.get(r.entryId) ?? -Infinity

  if (override === 'previousAsIs') {
    const previous = query.candidates
      .filter((c) => c.position <= query.target)
      .sort((a, b) => b.position - a.position || b.takenAt - a.takenAt)[0]
    return previous
      ? { ok: true, anchor: previous, records: [] }
      : { ok: false, reason: 'noAnchor' }
  }

  const next = query.candidates
    .filter((c) => c.position >= query.target)
    .sort((a, b) => a.takenAt - b.takenAt)[0]
  if (!next) return { ok: false, reason: 'noAnchor' }
  if (override === 'nextAsIs') return { ok: true, anchor: next, records: [] }
  const records = query.records.filter(
    (r) =>
      positionOf(r) > query.target && positionOf(r) <= next.position && r.createdAt <= next.takenAt,
  )
  return { ok: true, anchor: next, records }
}

/**
 * The records to put in a story file. A branch whose tracking this device cannot vouch for since
 * its last record (tracking is off now, or was turned on again after it) gets a break at the
 * end, so the importing device never treats what happened since as tracked.
 */
export function recordsForExport(
  records: WorldStateRecord[],
  tracking: { on: boolean; enabledSince: number | null },
  now: number,
): WorldStateRecord[] {
  const lastByBranch = new Map<string | null, WorldStateRecord>()
  for (const r of records) {
    const last = lastByBranch.get(r.branchId)
    if (!last || r.seq > last.seq) lastByBranch.set(r.branchId, r)
  }
  const maxSeq = records.reduce((max, r) => Math.max(max, r.seq), 0)
  const breaks: WorldStateRecord[] = []
  for (const last of lastByBranch.values()) {
    const vouched =
      tracking.on && tracking.enabledSince !== null && tracking.enabledSince <= last.createdAt
    if (vouched || last.kind === 'break') continue
    breaks.push({
      id: crypto.randomUUID(),
      storyId: last.storyId,
      branchId: last.branchId,
      entryId: last.entryId,
      seq: maxSeq + breaks.length + 1,
      createdAt: now,
      kind: 'break',
    })
  }
  return [...records, ...breaks]
}
