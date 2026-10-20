import type { WorldStateChangeRecord, WorldStateMark, WorldStateRecord } from '#lib/types/index.ts'
import { KEEP_NONE, planReversal, type ReversalPlan } from './reverse'
import type { TrackedState } from './state'

export interface ChapterLoreQuery {
  /** The chapter's last entry, which its lore sessions record on. */
  endEntryId: string
  /**
   * The chapter's mark. An earlier chapter deleted with its lore kept may have ended on the same
   * entry; its records come before this mark and are not this chapter's.
   */
  chapterSeq: number
  /** The records on the branch line. */
  records: WorldStateRecord[]
  entryPositions: Map<string, number>
  state: TrackedState
  tracking: { on: boolean; enabledSince: number | null }
}

/** A chapter's mark; -Infinity for one without, every record on its entry then being its own. */
export function chapterMark(marks: WorldStateMark[], chapterId: string): number {
  return marks.find((m) => m.entityType === 'chapter' && m.entityId === chapterId)?.seq ?? -Infinity
}

/**
 * Whose chapter lore these records are, entry by entry in their order: the chapter ending on the
 * entry where written after its mark, otherwise (null) a chapter since deleted there.
 */
export function loreOwners(
  records: WorldStateChangeRecord[],
  marks: WorldStateMark[],
  chapters: { id: string; endEntryId: string }[],
): { entryId: string; chapterId: string | null }[] {
  return [...new Set(records.map((r) => r.entryId))].flatMap((entryId) => {
    const written = records.filter((r) => r.entryId === entryId)
    const chapter = chapters.find((ch) => ch.endEntryId === entryId)
    const seq = chapter ? chapterMark(marks, chapter.id) : Infinity
    return [
      ...(chapter && written.some((r) => r.seq > seq) ? [{ entryId, chapterId: chapter.id }] : []),
      ...(written.some((r) => r.seq < seq) ? [{ entryId, chapterId: null }] : []),
    ]
  })
}

/**
 * The snapshots or checkpoints whose saved state holds what a chapter-lore undo reverts: those
 * marked after the first record it reverts, on entries of the open line. An ancestor branch's mark
 * past the fork sits on an entry the line does not have, and is left alone.
 */
export function marksHolding(
  marks: WorldStateMark[],
  reverted: WorldStateRecord[],
  lineEntryIds: ReadonlySet<string>,
  type: 'snapshot' | 'checkpoint',
): WorldStateMark[] {
  const since = Math.min(...reverted.map((r) => r.seq))
  return marks.filter((m) => m.entityType === type && m.seq > since && lineEntryIds.has(m.entryId))
}

/**
 * Why a chapter's lore cannot be undone: none was recorded, what came after may not be, or the
 * chapter belongs to the branch it was cut on, whose records the open branch only inherits.
 */
export type ChapterLoreRefusal = 'nothing' | 'untracked' | 'interrupted' | 'inherited'

export type ChapterLoreRevert =
  | { ok: false; reason: ChapterLoreRefusal }
  | {
      ok: true
      /** The chapter's own lorebook changes, which the plan undoes. */
      undone: WorldStateChangeRecord[]
      /** Every record the plan undoes: the chapter's and the later ones on the same entries. */
      reverted: WorldStateChangeRecord[]
      /** The later ones a chapter since deleted wrote, its lore kept. */
      deletedChapters: WorldStateChangeRecord[]
      plan: ReversalPlan
    }

/**
 * Undoing what a chapter's lore sessions wrote, and every later change to the same lorebook
 * entries with it: a record holds whole field values, so none can be applied again on top.
 * Refused unless everything since was recorded: an unrecorded edit would be overwritten.
 */
export function planChapterLoreRevert(query: ChapterLoreQuery): ChapterLoreRevert {
  const undone = query.records.filter(
    (r): r is WorldStateChangeRecord =>
      r.kind === 'change' &&
      r.origin === 'chapter' &&
      r.entityType === 'lorebook_entry' &&
      r.entryId === query.endEntryId &&
      r.seq > query.chapterSeq,
  )
  if (undone.length === 0) return { ok: false, reason: 'nothing' }

  const firstSeq = Math.min(...undone.map((r) => r.seq))
  const firstAt = Math.min(...undone.map((r) => r.createdAt))
  const { on, enabledSince } = query.tracking
  if (!on || enabledSince === null || enabledSince > firstAt)
    return { ok: false, reason: 'untracked' }
  const since = query.records.filter((r) => r.seq > firstSeq)
  if (since.some((r) => r.kind === 'break' || (r.kind === 'header' && !r.continuous))) {
    return { ok: false, reason: 'interrupted' }
  }

  // An override written later on a lightweight branch carries on the row it shadows.
  const ids = new Set(undone.map((r) => r.entityId))
  const own = new Set(undone.map((r) => r.id))
  const later: WorldStateChangeRecord[] = []
  for (const r of since) {
    if (r.kind !== 'change' || r.entityType !== 'lorebook_entry' || own.has(r.id)) continue
    const shadows = r.op === 'create' && ids.has((r.before as { id?: string } | null)?.id ?? '')
    if (shadows) ids.add(r.entityId)
    if (ids.has(r.entityId)) later.push(r)
  }

  const plan = planReversal({
    state: query.state,
    records: [...undone, ...later],
    entryPositions: query.entryPositions,
    keep: KEEP_NONE,
  })
  return {
    ok: true,
    undone,
    reverted: [...undone, ...later],
    deletedChapters: later.filter((r) => r.origin === 'chapter'),
    plan,
  }
}
