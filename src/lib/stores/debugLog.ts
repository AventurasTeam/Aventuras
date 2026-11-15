// Entries are replaced, never mutated: the log viewer's JSON cache is keyed on identity.
export type DebugLogEntry = {
  readonly id: string
  readonly timestamp: number
  readonly type: 'request' | 'response'
  readonly serviceName: string
  readonly data: Record<string, unknown>
  readonly duration?: number // For responses, time taken in ms
  readonly error?: string // For error responses
}

export type DebugLogChange = { kind: 'entry'; entry: DebugLogEntry } | { kind: 'reset' }

const MAX_ENTRIES = 100

/** The request/response log, free of runes and Tauri so any module (and any test) can write to it. */
export class DebugLog {
  /** Writes are dropped while this is false. */
  active = false
  private entries: DebugLogEntry[] = []
  private idCounter = 0
  private listener: ((change: DebugLogChange) => void) | undefined

  /** The one subscriber: the store, which turns changes into reactivity and window events. */
  onChange(listener: (change: DebugLogChange) => void) {
    this.listener = listener
  }

  snapshot(): DebugLogEntry[] {
    return [...this.entries]
  }

  get count(): number {
    return this.entries.length
  }

  get requestCount(): number {
    return this.entries.filter((e) => e.type === 'request').length
  }

  /** Returns the entry id for pairing with its response, or '' while inactive. */
  addRequest(serviceName: string, data: Record<string, unknown>, debugId?: string): string {
    if (!this.active) return ''
    let id = debugId || `debug-${++this.idCounter}-${Date.now()}`
    // Multi-step streamText reuses the same debugId for each fetch call.
    if (debugId && this.entries.some((e) => e.id === id || e.id === `${id}-response`)) {
      id = `${debugId}-${++this.idCounter}`
    }
    this.upsert({ id, timestamp: Date.now(), type: 'request', serviceName, data })
    return id
  }

  /** Merges into the response already logged for `requestId`, else adds one. */
  addResponse(
    requestId: string,
    serviceName: string,
    data: Record<string, unknown>,
    startTime: number,
    error?: string,
  ) {
    if (!this.active) return

    const entryId = `${requestId}-response`
    const existing = this.entries.find((e) => e.id === entryId)
    this.upsert(
      existing
        ? {
            ...existing,
            data: { ...existing.data, ...data },
            duration: Date.now() - startTime,
            error: error || existing.error,
          }
        : {
            id: entryId,
            timestamp: Date.now(),
            type: 'response',
            serviceName,
            data,
            duration: Date.now() - startTime,
            error,
          },
    )
  }

  /** Replaces the entry with the same id, else appends. Not gated on `active`: the pop-out mirrors. */
  upsert(entry: DebugLogEntry) {
    const index = this.entries.findIndex((e) => e.id === entry.id)
    if (index === -1) {
      this.entries.push(entry)
      if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES)
    } else {
      this.entries[index] = entry
    }
    this.listener?.({ kind: 'entry', entry })
  }

  reset(entries: DebugLogEntry[] = []) {
    this.entries = entries
    this.listener?.({ kind: 'reset' })
  }
}

export const debugLog = new DebugLog()
