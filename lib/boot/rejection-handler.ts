import { logger, redactSecretsInText } from '@/lib/diagnostics'

type RejectionTarget = {
  addEventListener?: (type: string, listener: (ev: unknown) => void) => void
}

type HermesRejectionTracker = {
  enablePromiseRejectionTracker?: (options: {
    allRejections?: boolean
    onUnhandled?: (id: number, rejection?: unknown) => void
    onHandled?: (id: number) => void
  }) => void
}

let registered = false

export function __resetRejectionHandlerForTest(): void {
  registered = false
}

const UNREPORTABLE_REASON = '<unreportable rejection reason>'

function stringifyReason(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason === null || reason === undefined) return String(reason)
  try {
    return JSON.stringify(reason) ?? String(reason)
  } catch {
    return String(reason)
  }
}

function messageFor(reason: unknown): string {
  if (reason instanceof Error) {
    if (typeof reason.stack === 'string') return reason.stack
    if (typeof reason.message === 'string') return reason.message
  }
  return stringifyReason(reason)
}

function report(reason: unknown, id: number): void {
  let error: string
  try {
    error = redactSecretsInText(messageFor(reason))
  } catch {
    error = UNREPORTABLE_REASON
  }
  logger.error('app.unhandled_rejection', { error, id })
}

function reportHandledLate(id: number | undefined): void {
  if (id === undefined) return
  logger.warn('app.rejection_handled_late', { id })
}

// No telemetry backend exists in this app, so an escaped rejection would
// otherwise produce no toast, no log line, and no diagnosticsStore entry.
export function registerRejectionHandler(target: RejectionTarget = globalThis): void {
  if (registered) return
  registered = true

  if (typeof target.addEventListener === 'function') {
    // The DOM events carry a Promise, not a numeric id — mint our own so a
    // rejectionhandled retraction can name the unhandledrejection it corrects.
    let nextId = 0
    const idsByPromise = new WeakMap<Promise<unknown>, number>()
    target.addEventListener('unhandledrejection', (ev) => {
      const { reason, promise } = ev as { reason?: unknown; promise?: Promise<unknown> }
      const id = nextId++
      if (promise != null) idsByPromise.set(promise, id)
      report(reason, id)
    })
    target.addEventListener('rejectionhandled', (ev) => {
      const { promise } = ev as { promise?: Promise<unknown> }
      reportHandledLate(promise != null ? idsByPromise.get(promise) : undefined)
    })
    return
  }

  // RN's and Expo's own dev-mode trackers already cover this; both are __DEV__-gated.
  if (typeof __DEV__ !== 'undefined' && __DEV__) return

  const hermes = (globalThis as { HermesInternal?: HermesRejectionTracker }).HermesInternal
  if (typeof hermes?.enablePromiseRejectionTracker === 'function') {
    hermes.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id, rejection) => report(rejection, id),
      onHandled: (id) => reportHandledLate(id),
    })
    return
  }

  // Fires before ensureDiagnosticsGate(), so the gate is still the module default
  // OFF — a kind this warn bypasses on both surfaces, so entry and console both land.
  logger.warn('app.rejection_tracker_unavailable')
}
