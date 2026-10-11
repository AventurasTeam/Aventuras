import type {
  StoryEntry,
  WorldStateChangeRecord,
  WorldStateHeaderRecord,
  WorldStateRecord,
} from '#lib/types/index.ts'

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
  | 'targetUntracked'
  | 'targetClassifierOnly'
  | 'untracked'
  | 'interrupted'
  | 'classifierOnly'
  | 'noAnchor'

/** The first thing that breaks the tracked sequence between an entry and a full state. */
export type RunGap =
  /**
   * A narration played without State Tracking, or recorded before lorebook and manual changes
   * were. `throughEntryId` ends a run of consecutive narrations with the same problem; null for
   * one narration alone.
   */
  | { cause: 'untracked' | 'classifierOnly'; entryId: string; throughEntryId: string | null }
  /**
   * A header written as not continuing the run before it. `sinceEntryId` is the entry of the
   * last thing recorded before it, if any.
   */
  | { cause: 'header'; entryId: string; sinceEntryId: string | null }
  /** An export that could not vouch for tracking since the branch's last record. */
  | { cause: 'break'; entryId: string }
  | { cause: 'trackingOff' }
  /**
   * Tracking was turned on after the last thing it recorded, at `sinceEntryId`; null when only
   * legacy records exist. `enabledSince` is null when tracking has no start time.
   */
  | { cause: 'enabledAfter'; sinceEntryId: string | null; enabledSince: number | null }

export type RunResult =
  | {
      ok: true
      anchor: AnchorCandidate
      /** Records to undo from the anchor. */
      records: WorldStateRecord[]
      /** Changes that belong to the target but were written after the anchor was saved. */
      late: WorldStateChangeRecord[]
    }
  | { ok: false; reason: RunRefusal; diagnosis?: RunDiagnosis }

/** Why a past state was refused, as the three things a rebuild needs. */
export interface RunDiagnosis {
  /** How the entry's own changes were recorded: in full, in the old classifier-only form, or not. */
  target: 'recorded' | 'classifierOnly' | 'untracked'
  /** The nearest full state after the entry, or the one that passed. */
  anchor: AnchorCandidate | null
  /** Everything breaking the tracked sequence between the entry and `anchor`, in story order. */
  gaps: RunGap[]
}

export interface RunQuery {
  /** Every entry on the branch line. */
  line: LineEntry[]
  /** Every record on the branch line, legacy deltas included. */
  records: WorldStateRecord[]
  /** The automatic and closing snapshots on the branch: their entry and when each was taken. */
  snapshots: { entryId: string; takenAt: number }[]
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
  // Old classifier-only records were written whatever the reader did by hand, so they prove nothing.
  const legacy = new Set(
    query.records
      .filter((r) => r.kind === 'header' && r.coverage === 'classifier')
      .map((r) => r.entryId),
  )
  const tracked = query.records.filter((r) => !legacy.has(r.entryId))
  const fullyHeaded = new Set(
    tracked.filter((r) => r.kind === 'header' && r.coverage === 'full').map((r) => r.entryId),
  )
  const proofs = [
    ...tracked
      .filter((r) => r.kind !== 'break')
      .map((r) => ({ at: r.createdAt, entryId: r.entryId })),
    // A snapshot is taken right after its entry is classified, so one on an entry without a full
    // header was taken before full recording began.
    ...query.snapshots
      .filter((s) => fullyHeaded.has(s.entryId))
      .map((s) => ({ at: s.takenAt, entryId: s.entryId })),
  ].sort((a, b) => a.at - b.at)
  const lastProofBefore = (t: number) => {
    let found: { at: number; entryId: string } | null = null
    for (const p of proofs) if (p.at < t) found = p
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
      from: since?.at ?? -Infinity,
      to: header.createdAt,
      cause: { cause: 'header', entryId: header.entryId, sinceEntryId: since?.entryId ?? null },
    })
  }
  for (const brk of tracked.filter((r) => r.kind === 'break')) {
    const next = headers.find((h) => h.createdAt > brk.createdAt)
    intervals.push({
      from: brk.createdAt,
      to: next?.createdAt ?? Infinity,
      cause: { cause: 'break', entryId: brk.entryId },
    })
  }
  const lastProof = proofs.length > 0 ? proofs[proofs.length - 1] : null
  const lastProofAt = lastProof?.at ?? -Infinity
  const { on, enabledSince } = query.tracking
  if (!on) intervals.push({ from: lastProofAt, to: Infinity, cause: { cause: 'trackingOff' } })
  else if (enabledSince === null || enabledSince > lastProofAt) {
    intervals.push({
      from: lastProofAt,
      to: enabledSince ?? Infinity,
      cause: { cause: 'enabledAfter', sinceEntryId: lastProof?.entryId ?? null, enabledSince },
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
  const intervals = suspectIntervals(query)

  const headersByEntry = new Map<string, WorldStateHeaderRecord>()
  for (const r of query.records) if (r.kind === 'header') headersByEntry.set(r.entryId, r)

  const target = line.find((e) => e.position === query.target)
  const targetHeader = target ? headersByEntry.get(target.id) : undefined
  const candidates = query.candidates
    .filter((c) => c.position >= query.target)
    .sort((a, b) => a.takenAt - b.takenAt)

  const checked = candidates.map((anchor) => ({ anchor, gaps: checkAnchor(anchor) }))
  const passed = checked.find((c) => c.gaps.length === 0)
  const diagnosed = passed ?? checked[0]
  const diagnosis: RunDiagnosis = {
    target: !targetHeader
      ? 'untracked'
      : targetHeader.coverage === 'classifier'
        ? 'classifierOnly'
        : 'recorded',
    anchor: diagnosed?.anchor ?? null,
    gaps: diagnosed?.gaps ?? [],
  }

  if (diagnosis.target === 'untracked') return { ok: false, reason: 'targetUntracked', diagnosis }
  if (diagnosis.target === 'classifierOnly') {
    return { ok: false, reason: 'targetClassifierOnly', diagnosis }
  }
  if (!diagnosed) return { ok: false, reason: 'noAnchor', diagnosis }
  if (!passed) return { ok: false, reason: refusalFor(diagnosed.gaps[0]), diagnosis }
  return { ok: true, ...rebuildFrom(query, passed.anchor) }

  function checkAnchor(anchor: AnchorCandidate): RunGap[] {
    if (!next) return []
    const spanned = line.filter(
      (e) => e.type === 'narration' && e.position > query.target && e.position <= anchor.position,
    )
    const problem = (e: LineEntry) => {
      const header = headersByEntry.get(e.id)
      if (!header) return 'untracked' as const
      return header.coverage === 'classifier' ? ('classifierOnly' as const) : null
    }

    // Consecutive narrations with the same problem are reported as one stretch.
    const gaps: RunGap[] = []
    type Stretch = Extract<RunGap, { cause: 'untracked' | 'classifierOnly' }>
    let stretch = null as Stretch | null
    for (const entry of spanned) {
      const cause = problem(entry)
      if (cause && stretch?.cause === cause) {
        stretch.throughEntryId = entry.id
        continue
      }
      stretch = cause ? { cause, entryId: entry.id, throughEntryId: null } : null
      if (stretch) gaps.push(stretch)
    }

    // What the entries show already accounts for a pause that has no entry to place it at.
    const from = next.createdAt
    for (const interval of intervals) {
      if (!(interval.from < anchor.takenAt && interval.to > from)) continue
      const { cause } = interval
      const unplaced =
        (cause.cause === 'header' || cause.cause === 'enabledAfter') && cause.sinceEntryId === null
      if (unplaced && gaps.length > 0) continue
      if (!gaps.some((g) => JSON.stringify(g) === JSON.stringify(cause))) gaps.push(cause)
    }
    return gaps
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
  if (override === 'previousAsIs') {
    const previous = query.candidates
      .filter((c) => c.position <= query.target)
      .sort((a, b) => b.position - a.position || b.takenAt - a.takenAt)[0]
    return previous
      ? { ok: true, anchor: previous, records: [], late: [] }
      : { ok: false, reason: 'noAnchor' }
  }

  const next = query.candidates
    .filter((c) => c.position >= query.target)
    .sort((a, b) => a.takenAt - b.takenAt)[0]
  if (!next) return { ok: false, reason: 'noAnchor' }
  if (override === 'nextAsIs') return { ok: true, anchor: next, records: [], late: [] }
  return { ok: true, ...rebuildFrom(query, next) }
}

/**
 * What rebuilding `query.target` from `anchor` takes: the records it holds for later entries,
 * to undo, and the changes for the target or earlier written after it was saved, to apply.
 */
function rebuildFrom(
  query: RunQuery,
  anchor: AnchorCandidate,
): { anchor: AnchorCandidate; records: WorldStateRecord[]; late: WorldStateChangeRecord[] } {
  const positions = new Map(query.line.map((e) => [e.id, e.position]))
  const positionOf = (r: WorldStateRecord) => positions.get(r.entryId) ?? -Infinity
  const records = query.records.filter(
    (r) =>
      positionOf(r) > query.target &&
      positionOf(r) <= anchor.position &&
      r.createdAt <= anchor.takenAt,
  )
  const late = query.records.filter(
    (r): r is WorldStateChangeRecord =>
      r.kind === 'change' && positionOf(r) <= query.target && r.createdAt > anchor.takenAt,
  )
  return { anchor, records, late }
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
