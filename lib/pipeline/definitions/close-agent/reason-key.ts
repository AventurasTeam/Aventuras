import { isCloseReasonKey, type CloseReasonKey, type CloseTask } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

const KEY_END = ': '

/** The call a reason came from, for the log. */
type ReasonCall = { actionId: string; task: CloseTask; tool: string }

/** A close-built refusal for the model, keyed for the ledger: `<key>: <text>`. */
export function keyedReason(key: CloseReasonKey, text: string): string {
  return `${key}${KEY_END}${text}`
}

/** A reason's ledger key: its text before the first `: `, or all of it; else `other`, logged. */
export function ledgerReasonKey(
  reason: string,
  { actionId, task, tool }: ReasonCall,
): CloseReasonKey {
  const end = reason.indexOf(KEY_END)
  const head = end === -1 ? reason : reason.slice(0, end)
  if (isCloseReasonKey(head)) return head
  logger.warn('memory.close_reason_unkeyed', { reason, task, tool }, { actionId })
  return 'other'
}
