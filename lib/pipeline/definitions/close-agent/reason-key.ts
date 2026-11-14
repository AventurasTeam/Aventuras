import { isCloseReasonKey, type CloseReasonKey } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

const KEY_END = ': '

/** A close-built refusal for the model, keyed for the ledger: `<key>: <text>`. */
export function keyedReason(key: CloseReasonKey, text: string): string {
  return `${key}${KEY_END}${text}`
}

/** The ledger's key for a reason: its text before the first `: `, or all of it; else `other`, logged. */
export function ledgerReasonKey(reason: string): CloseReasonKey {
  const end = reason.indexOf(KEY_END)
  const head = end === -1 ? reason : reason.slice(0, end)
  if (isCloseReasonKey(head)) return head
  logger.warn('memory.close_reason_unkeyed', { reason })
  return 'other'
}
