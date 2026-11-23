import { logger } from '@/lib/diagnostics'

export type LogRewrittenListener = (branchId: string) => void

// One entry per registration, so a function registered twice unregisters one at a time.
const registrations = new Set<{ readonly listener: LogRewrittenListener }>()

/** Hears each commit that rewrote a branch's log (reversal, redo, journal write-back). */
export function onLogRewritten(listener: LogRewrittenListener): () => void {
  const registration = { listener }
  registrations.add(registration)
  return () => {
    registrations.delete(registration)
  }
}

/** Fired by the three commit tails; not on the barrel. Never throws. */
export function logRewritten(branchId: string): void {
  for (const { listener } of [...registrations]) {
    try {
      listener(branchId)
    } catch (e) {
      logger.error('action_layer.log_rewritten_listener_failed', {
        branchId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
}
