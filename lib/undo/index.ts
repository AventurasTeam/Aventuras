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
  // 'per_turn_classifier' is deliberately not filtered here: unlike
  // 'periodic_classifier' (a real background pass with its own later
  // action_id), it always shares the triggering turn's action_id, so it's
  // already part of that turn's group below — never a lone commit to skip.
  const head = rows.find((r) => r.source !== 'periodic_classifier')
  if (!head) return null

  const group = rows.filter((r) => r.actionId === head.actionId)
  const creates = group.filter((r) => r.targetTable === 'story_entries' && r.op === 'create')
  // DESC-ordered input: a turn's group can hold two creates (user_action, ai_reply)
  // sharing one actionId. The last match is the earliest (lowest log_position),
  // anchoring the reversal window at the turn's true start.
  const turnCreate = creates.at(-1)
  if (turnCreate) return { actionId: head.actionId, kind: 'turn', entryId: turnCreate.targetId }
  return { actionId: head.actionId, kind: 'group' }
}
