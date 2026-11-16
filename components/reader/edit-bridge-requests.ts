import type { EditResult, EditSession } from './reader-document-types'

/** What the reader document sends back for one of the host's edit requests. */
export type EditBridgeAnswer =
  | { kind: 'query'; session: EditSession | null }
  | { kind: 'commit'; result: EditResult }

type Unanswered = 'unresponsive'

type AnswerOf<K extends EditBridgeAnswer['kind']> = K extends 'query'
  ? EditSession | null
  : EditResult

type Pending = { kind: EditBridgeAnswer['kind']; settle: (answer: unknown) => void }

type Schedule = (run: () => void, ms: number) => () => void

const realSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

// A boot took the document's editor with it (reader-composer.md → Inline edit session), so a
// question it never answered resolves as no editor, and a commit as clean.
const AFTER_BOOT: { [K in EditBridgeAnswer['kind']]: AnswerOf<K> } = {
  query: null,
  commit: { ok: true },
}

/**
 * Native→DOM calls return nothing over the expo-dom bridge, so each edit request carries an id
 * the document answers through a callback. A request unanswered past its timeout resolves
 * `unresponsive`; a late answer then finds nothing waiting and is dropped.
 */
export function createEditRequests({
  queryTimeoutMs,
  commitTimeoutMs,
  schedule = realSchedule,
}: {
  queryTimeoutMs: number
  commitTimeoutMs: number
  schedule?: Schedule
}) {
  const pending = new Map<string, Pending>()
  let nextId = 0

  function ask<K extends EditBridgeAnswer['kind']>(
    kind: K,
    send: (requestId: string) => void,
  ): Promise<AnswerOf<K> | Unanswered> {
    const requestId = `edit-${++nextId}`
    return new Promise((resolve) => {
      const cancelTimer = schedule(
        () => {
          if (pending.delete(requestId)) resolve('unresponsive')
        },
        kind === 'query' ? queryTimeoutMs : commitTimeoutMs,
      )
      pending.set(requestId, {
        kind,
        settle: (answer) => {
          cancelTimer()
          resolve(answer as AnswerOf<K>)
        },
      })
      try {
        send(requestId)
      } catch {
        // A document mid-reload has no handle yet; the timeout or the boot answers for it.
      }
    })
  }

  return {
    ask,
    answer(requestId: string, answer: EditBridgeAnswer): void {
      const request = pending.get(requestId)
      if (request == null || request.kind !== answer.kind) return
      pending.delete(requestId)
      request.settle(answer.kind === 'query' ? answer.session : answer.result)
    },
    /** A document boot: every request waiting on the old document resolves as no editor. */
    resetAll(): void {
      const waiting = [...pending.values()]
      pending.clear()
      for (const request of waiting) request.settle(AFTER_BOOT[request.kind])
    },
  }
}

export type EditRequests = ReturnType<typeof createEditRequests>
