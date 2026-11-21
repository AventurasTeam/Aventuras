import type { Delta } from '@/lib/db'

import { DIVIDER_TABLES } from '../chapters/close-groups'

export type JournalHead = { actionId: string; chapterId: string; floor: number }

// No journal covers the chapter's own row, whoever wrote it, nor a close's stamps.
function outsideAnyJournal(d: Delta, head: JournalHead): boolean {
  const chapterRow = d.targetTable === 'chapters' && d.targetId === head.chapterId
  const stamp = d.targetTable === 'story_entries' && d.source === 'chapter_close'
  return chapterRow || stamp
}

/**
 * The heads a reversal drops, each whose write-back it would make inexact
 * (generation-pipeline.md → Reverse-replay).
 */
export function journalsToDrop(args: {
  heads: readonly JournalHead[]
  /** plan.prunedDeltas and plan.reownedDeltas: every delta that leaves the log or its group. */
  removed: readonly Delta[]
  /** plan.rewrittenHolders and survivorRewrites' deltas: payloads the plan edits in place. */
  rewritten: readonly Delta[]
  /**
   * Each head's group, by action id, as it stands before the reversal. A head the set removes no
   * delta of may be absent: its group cannot empty.
   */
  groups: ReadonlyMap<string, readonly Delta[]>
}): readonly JournalHead[] {
  const { heads, removed, rewritten, groups } = args
  const removedIds = new Set(removed.map((d) => d.id))
  const touched = [...removed, ...rewritten]
  return heads.filter((head) => {
    const takesLore = removed.some(
      (d) => d.actionId === head.actionId && !DIVIDER_TABLES.has(d.targetTable),
    )
    const sweepsBelow = touched.some(
      (d) => d.logPosition <= head.floor && !outsideAnyJournal(d, head),
    )
    const group = groups.get(head.actionId) ?? []
    const taken = group.filter((d) => removedIds.has(d.id)).length
    const emptiesGroup = taken > 0 && taken === group.length
    return takesLore || sweepsBelow || emptiesGroup
  })
}
