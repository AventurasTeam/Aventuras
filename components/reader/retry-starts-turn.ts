import type { SystemFailureMeta } from '@/lib/db'

/** Whether the system entry's Retry starts a turn: a failed pass's or close's reruns that work. */
export function retryStartsTurn(failure: SystemFailureMeta | undefined): boolean {
  return failure?.pass !== 'failed' && failure?.close !== 'failed'
}
