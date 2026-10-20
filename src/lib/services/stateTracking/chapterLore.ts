import type { WorldStateChangeRecord, WorldStateMark, WorldStateRecord } from '#lib/types/index.ts'
import { KEEP_ALL, planReversal, type ReversalPlan, type RevertKeep } from './reverse'
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
  /** Which later changes to the same entries are applied again; all of them unless given. */
  keep?: RevertKeep
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

/** Why a chapter's lore cannot be undone: none was recorded, or what came after may not be. */
export type ChapterLoreRefusal = 'nothing' | 'untracked' | 'interrupted'

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
 * Undoing what a chapter's lore sessions wrote, with the later changes to the same lorebook
 * entries the reader keeps applied again on top. A kept change writes back its fields whole, the
 * chapter's text included where the reader edited over it. Refused unless everything since was
 * recorded: an unrecorded edit would be overwritten.
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
    keep: query.keep ?? KEEP_ALL,
  })
  return {
    ok: true,
    undone,
    reverted: [...undone, ...later],
    deletedChapters: later.filter((r) => r.origin === 'chapter'),
    plan,
  }
}
