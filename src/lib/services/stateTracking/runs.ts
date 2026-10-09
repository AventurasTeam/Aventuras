import type {
  StoryEntry,
  WorldStateHeaderRecord,
  WorldStateRecord,
} from '$lib/types'

export type LineEntry = Pick<StoryEntry, 'id' | 'position' | 'type' | 'createdAt'>

/**
 * Whether tracking ran without interruption since `previous`, the last header on the branch
 * line. Turning tracking on resets `enabledSince`, so a header written before it cannot vouch.
 */
export function isContinuous(
  previous: WorldStateHeaderRecord | null,
  enabledSince: number | null,
  breakSincePrevious: boolean,
): boolean {
  return (
    previous !== null &&
    previous.coverage === 'full' &&
    enabledSince !== null &&
    previous.createdAt >= enabledSince &&
    !breakSincePrevious
  )
}

export interface AnchorCandidate {
  kind: 'snapshot' | 'checkpoint' | 'live'
  id: string | null
  /** Position of the entry the state was taken at. */
  position: number
  takenAt: number
}

export type RunRefusal = 'untracked' | 'interrupted' | 'classifierOnly' | 'noAnchor'

export type RunResult =
  | { ok: true; anchor: AnchorCandidate; records: WorldStateRecord[] }
  | { ok: false; reason: RunRefusal }

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

type Interval = [from: number, to: number]

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
    if (!header.continuous) intervals.push([lastProofBefore(header.createdAt), header.createdAt])
  }
  for (const brk of tracked.filter((r) => r.kind === 'break')) {
    const next = headers.find((h) => h.createdAt > brk.createdAt)
    intervals.push([brk.createdAt, next?.createdAt ?? Infinity])
  }
  const lastProof = proofs.length > 0 ? proofs[proofs.length - 1] : -Infinity
  const { on, enabledSince } = query.tracking
  if (!on) intervals.push([lastProof, Infinity])
  else if (enabledSince === null || enabledSince > lastProof) {
    intervals.push([lastProof, enabledSince ?? Infinity])
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

  const candidates = query.candidates
    .filter((c) => c.position >= query.target)
    .sort((a, b) => a.takenAt - b.takenAt)
  if (candidates.length === 0) return { ok: false, reason: 'noAnchor' }

  let firstRefusal: RunRefusal | null = null
  for (const anchor of candidates) {
    const refusal = checkAnchor(anchor)
    if (refusal === null) {
      const records = query.records.filter(
        (r) =>
          positionOf(r) > query.target &&
          positionOf(r) <= anchor.position &&
          r.createdAt <= anchor.takenAt,
      )
      return { ok: true, anchor, records }
    }
    firstRefusal ??= refusal
  }
  return { ok: false, reason: firstRefusal ?? 'noAnchor' }

  function checkAnchor(anchor: AnchorCandidate): RunRefusal | null {
    if (!next) return null
    const from = next.createdAt
    if (intervals.some(([lo, hi]) => lo < anchor.takenAt && hi > from)) return 'interrupted'

    for (const entry of line) {
      if (entry.position <= query.target || entry.position > anchor.position) continue
      if (entry.type !== 'narration') continue
      const header = headersByEntry.get(entry.id)
      if (!header) return 'untracked'
      if (header.coverage === 'classifier') return 'classifierOnly'
    }

    // A change that belongs to the target's state but came after the anchor is not in it.
    const missed = query.records.some(
      (r) => r.kind === 'change' && positionOf(r) <= query.target && r.createdAt > anchor.takenAt,
    )
    return missed ? 'interrupted' : null
  }
}
