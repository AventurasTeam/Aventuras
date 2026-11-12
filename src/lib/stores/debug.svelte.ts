import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

export function countRequests(debugLogs: Array<DebugLogEntry>) {
  return debugLogs.reduce((req, e) => {
    return req + (e.type === 'request' ? 1 : 0)
  }, 0)
}

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

class DebugStore {
  // Debug mode state - session-only request/response logging
  isActive = $state(false)
  // Non-reactive storage - UI pulls updates via getSnapshot()
  private debugLogs: DebugLogEntry[] = []
  // Reactive signal that increments when logs change - UI can track this
  logsVersion = $state(0)
  debugModalOpen = $state(false)
  debugWindowActive = $state(false)
  debugRenderNewlines = $state(false)
  private debugLogIdCounter = 0
  private unlistenPopIn: UnlistenFn | null = null
  private unlistenRequestLogs: UnlistenFn | null = null
  private unlistenClearLogs: UnlistenFn | null = null
  private unlistenToggleRenderNewlines: UnlistenFn | null = null
  /** See emitToDebugWindow: false from window creation until the window reports ready. */
  private debugWindowReady = false

  /**
   * Send an event to the pop-out window, but only once that window is ready.
   *
   * Emitting while the new window is still making its own setup IPC calls deadlocks the
   * whole app. Tauri 2.11 holds `webviews_lock` for the entire emit (manager/mod.rs:548)
   * and the emit blocks waiting on the main thread, while the main thread needs that same
   * lock to answer the new window's `listen`/`emit` calls. Neither side yields, the GTK
   * event loop stops, and every window freezes with the CPU at zero.
   *
   * Events sent before then are dropped rather than queued: every one of them is already
   * reflected in `debugLogs`, which `initial-debug-logs` hands over in full.
   */
  private emitToDebugWindow(event: string, payload: unknown) {
    // `debugWindowReady` alone, deliberately: it is set by the window announcing itself, so
    // it already implies the window exists. Requiring `debugWindowActive` as well would
    // reintroduce a race in the other direction -- that flag is assigned at the *end* of
    // `popOutDebug`, after the window is constructed, so a window that announced itself
    // first would have its own initial-logs reply dropped.
    if (!this.debugWindowReady) return

    emit(event, payload).catch((err) => {
      console.warn(`[UI] Failed to emit ${event}:`, err)
    })
  }

  /**
   * Get a snapshot of current logs. UI should call this when logsVersion changes.
   */
  getSnapshot(): DebugLogEntry[] {
    return [...this.debugLogs]
  }

  /**
   * Get current log count reactively.
   */
  get requestCount(): number {
    // touch logsVersion to make this reactive
    void this.logsVersion
    return countRequests(this.debugLogs)
  }

  // Debug log methods
  private appendLogEntry(entry: DebugLogEntry) {
    // Keep only last 100 entries to prevent memory issues
    if (this.debugLogs.push(entry) > 100) {
      this.debugLogs = this.debugLogs.slice(-100)
    }

    // Signal that logs have changed
    this.logsVersion++
  }

  /** Replaces the entry with the same id, else appends. */
  private upsertEntry(entry: DebugLogEntry) {
    const index = this.debugLogs.findIndex((l) => l.id === entry.id)
    if (index === -1) {
      this.appendLogEntry(entry)
      return
    }
    this.debugLogs[index] = entry
    this.logsVersion++
  }

  private resetLogs(logs: DebugLogEntry[] = []) {
    this.debugLogs = logs
    this.logsVersion++
  }

  /** Max IPC payload size for external window events (~500KB). */
  private static readonly DEBUG_IPC_LIMIT = 500_000

  /**
   * Returns a version of the entry safe to send over Tauri IPC.
   * If the serialized size exceeds the limit, replaces data with a truncation notice.
   */
  private safeIpcEntry(entry: DebugLogEntry): object {
    try {
      const json = JSON.stringify(entry)
      if (json.length <= DebugStore.DEBUG_IPC_LIMIT) return JSON.parse(json)
      return {
        ...entry,
        data: { _truncated: true, _originalSize: json.length, _note: 'Payload too large for IPC' },
      }
    } catch {
      return { ...entry, data: { _serializeError: true } }
    }
  }

  /**
   * Add a request log entry. Returns the entry ID for pairing with response.
   */
  addDebugRequest(serviceName: string, data: Record<string, unknown>, debugId?: string): string {
    if (!this.isActive) return ''
    let id = debugId || `debug-${++this.debugLogIdCounter}-${Date.now()}`
    // Multi-step streamText reuses the same debugId for each fetch call — deduplicate
    if (debugId && this.debugLogs.some((e) => e.id === id || e.id === `${id}-response`)) {
      id = `${debugId}-${++this.debugLogIdCounter}`
    }
    const entry: DebugLogEntry = {
      id,
      timestamp: Date.now(),
      type: 'request',
      serviceName,
      data,
    }

    this.appendLogEntry(entry)

    this.emitToDebugWindow('debug-log-added', this.safeIpcEntry(entry))

    return id
  }

  /**
   * Add a response log entry paired with a request.
   */
  addDebugResponse(
    requestId: string,
    serviceName: string,
    data: Record<string, unknown>,
    startTime: number,
    error?: string,
  ) {
    if (!this.isActive) return

    const entryId = `${requestId}-response`
    const existing = this.debugLogs.find((l) => l.id === entryId)

    const entry: DebugLogEntry = existing
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
        }

    this.upsertEntry(entry)
    this.emitToDebugWindow('debug-log-added', this.safeIpcEntry(entry))
  }

  /**
   * Clear all debug logs (session clear).
   */
  clearDebugLogs() {
    this.resetLogs()
    this.emitToDebugWindow('debug-logs-cleared', {})
  }

  /**
   * Open the debug log modal.
   */
  openDebugModal() {
    this.debugModalOpen = true
  }

  /**
   * Close the debug log modal.
   */
  closeDebugModal() {
    this.debugModalOpen = false
  }

  /**
   * Toggle the debug log modal.
   */
  toggleDebugModal() {
    this.debugModalOpen = !this.debugModalOpen
  }

  /**
   * Toggle rendering of newlines in debug logs.
   */
  toggleDebugRenderNewlines() {
    this.debugRenderNewlines = !this.debugRenderNewlines
    console.log('[UI] toggleDebugRenderNewlines', this.debugRenderNewlines)
    this.emitToDebugWindow('debug-render-newlines-changed', this.debugRenderNewlines)
  }

  /** Listeners for everything the pop-out window sends back. */
  private async registerDebugWindowListeners() {
    this.unlistenPopIn = await listen('pop-in-debug', () => {
      console.log('[UI] Received pop-in-debug request')
      this.popInDebug()
    })

    // The window sends this once its own listeners are up, which is also our signal that
    // it is done making setup IPC calls and is safe to emit to. See emitToDebugWindow.
    this.unlistenRequestLogs = await listen('request-initial-debug-logs', () => {
      console.log('[UI] Received request-initial-debug-logs')
      this.debugWindowReady = true
      this.emitToDebugWindow('initial-debug-logs', {
        logs: this.debugLogs.map((e) => this.safeIpcEntry(e) as DebugLogEntry),
        renderNewlines: this.debugRenderNewlines,
      })
    })

    this.unlistenClearLogs = await listen('request-clear-debug-logs', () => {
      this.clearDebugLogs()
    })

    this.unlistenToggleRenderNewlines = await listen('request-toggle-debug-render-newlines', () => {
      this.toggleDebugRenderNewlines()
    })
  }

  /**
   * Pop out the debug logs into a separate window.
   */
  async popOutDebug() {
    if (this.debugWindowActive) return

    try {
      // Listeners go up before the window exists. They used to be registered after, which
      // left a gap where a fast-loading window could announce itself to nobody -- and,
      // worse, put our own `listen` IPC calls in the same instant as the new window's.
      this.debugWindowReady = false
      await this.registerDebugWindowListeners()

      const win = new WebviewWindow('debug-logs', {
        url: '/debug',
        title: 'API Debug Logs',
        width: 1000,
        height: 800,
        minWidth: 800,
        minHeight: 600,
      })

      win.once('tauri://error', (e) => {
        console.error('[UI] Failed to create debug window:', e)
        this.debugWindowActive = false
        this.debugWindowReady = false
      })

      win.once('tauri://destroyed', () => {
        console.log('[UI] Debug window destroyed')
        this.debugWindowActive = false
        this.debugWindowReady = false
        if (this.unlistenPopIn) {
          this.unlistenPopIn()
          this.unlistenPopIn = null
        }
        if (this.unlistenRequestLogs) {
          this.unlistenRequestLogs()
          this.unlistenRequestLogs = null
        }
        if (this.unlistenClearLogs) {
          this.unlistenClearLogs()
          this.unlistenClearLogs = null
        }
        if (this.unlistenToggleRenderNewlines) {
          this.unlistenToggleRenderNewlines()
          this.unlistenToggleRenderNewlines = null
        }
      })

      this.debugWindowActive = true
    } catch (err) {
      console.error('[UI] Error popping out debug window:', err)
      //ui.showToast('Failed to pop out debug window', 'error')
    }
  }

  /**
   * Pop back in - close the external window and focus the modal.
   */
  async popInDebug() {
    console.log('[UI] popInDebug called', { debugWindowActive: this.debugWindowActive })
    if (!this.debugWindowActive) return

    try {
      const win = await WebviewWindow.getByLabel('debug-logs')
      if (win) {
        console.log('[UI] Closing debug-logs window')
        await win.close()
      } else {
        console.warn('[UI] debug-logs window not found by label')
      }
      this.debugWindowActive = false
      // Cleared here as well as in the `tauri://destroyed` handler, which does not fire on
      // the branch above where the window could not be found by label. Leaving it set would
      // keep every subsequent log emitting to a window that is gone.
      this.debugWindowReady = false
      this.debugModalOpen = true
    } catch (err) {
      console.error('[UI] Error popping in debug window:', err)
    }
  }
}

export const debug = new DebugStore()
