export type UndoCandidateDelta = {
  actionId: string
  source: string
  targetTable: string
  targetId: string
  op: 'create' | 'update' | 'delete'
}

export type UndoTarget =
  | { actionId: string; kind: 'turn'; entryId: string }
  | { actionId: string; kind: 'group' }

// Rows MUST be pre-ordered newest-first (log_position DESC) by the caller —
// this function only classifies, it never re-sorts (data-model.md -> CTRL-Z algorithm).
export function selectUndoTarget(rows: readonly UndoCandidateDelta[]): UndoTarget | null {
  const head = rows.find((r) => r.source !== 'periodic_classifier')
  if (!head) return null

  const group = rows.filter((r) => r.actionId === head.actionId)
  const turnCreate = group.find((r) => r.targetTable === 'story_entries' && r.op === 'create')
  if (turnCreate) return { actionId: head.actionId, kind: 'turn', entryId: turnCreate.targetId }
  return { actionId: head.actionId, kind: 'group' }
}
