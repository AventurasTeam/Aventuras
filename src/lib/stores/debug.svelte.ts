import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

// Debug log entry for request/response logging
export type DebugLogEntry = {
  id: string
  timestamp: number
  type: 'request' | 'response'
  serviceName: string
  data: Record<string, unknown>
  duration?: number // For responses, time taken in ms
  error?: string // For error responses
}

class DebugStore {
  // Debug mode state - session-only request/response logging
  isActive = $state(false)
  debugLogs = $state<DebugLogEntry[]>([])
  debugModalOpen = $state(false)
  debugWindowActive = $state(false)
  debugRenderNewlines = $state(false)
  private debugLogIdCounter = 0
  private unlistenPopIn: UnlistenFn | null = null
  private unlistenRequestLogs: UnlistenFn | null = null
  private unlistenClearLogs: UnlistenFn | null = null
  private unlistenToggleRenderNewlines: UnlistenFn | null = null

  // Debug log methods

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
    if (debugId && this.debugLogs.some((e) => e.id === id)) {
      id = `${debugId}-${++this.debugLogIdCounter}`
    }
    const entry: DebugLogEntry = {
      id,
      timestamp: Date.now(),
      type: 'request',
      serviceName,
      data,
    }
    // Keep only last 100 entries to prevent memory issues
    if (this.debugLogs.push(entry) > 100) {
      this.debugLogs = this.debugLogs.slice(-100)
    }

    // Notify external window if active
    if (this.debugWindowActive) {
      console.log('[UI] Emitting debug-log-added', entry.id)
      emit('debug-log-added', this.safeIpcEntry(entry)).catch((err) => {
        console.warn('[UI] Failed to emit debug-log-added:', err)
      })
    }

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

    const entry: DebugLogEntry = {
      id: `${requestId}-response`,
      timestamp: Date.now(),
      type: 'response',
      serviceName,
      data,
      duration: Date.now() - startTime,
      error,
    }
    // Keep only last 100 entries to prevent memory issues
    if (this.debugLogs.push(entry) > 100) {
      this.debugLogs = this.debugLogs.slice(-100)
    }

    // Notify external window if active
    if (this.debugWindowActive) {
      console.log('[UI] Emitting debug-log-added', entry.id)
      emit('debug-log-added', this.safeIpcEntry(entry)).catch((err) => {
        console.warn('[UI] Failed to emit debug-log-added:', err)
      })
    }
  }

  /**
   * Clear all debug logs (session clear).
   */
  clearDebugLogs() {
    this.debugLogs = []
    if (this.debugWindowActive) {
      emit('debug-logs-cleared', {}).catch((err) => {
        console.warn('[UI] Failed to emit debug-logs-cleared:', err)
      })
    }
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
    if (this.debugWindowActive) {
      emit('debug-render-newlines-changed', this.debugRenderNewlines).catch((err) => {
        console.warn('[UI] Failed to emit debug-render-newlines-changed:', err)
      })
    }
  }

  /**
   * Pop out the debug logs into a separate window.
   */
  async popOutDebug() {
    if (this.debugWindowActive) return

    try {
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
      })

      win.once('tauri://destroyed', () => {
        console.log('[UI] Debug window destroyed')
        this.debugWindowActive = false
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

      // Listen for "pop in" request from the external window
      this.unlistenPopIn = await listen('pop-in-debug', () => {
        console.log('[UI] Received pop-in-debug request')
        this.popInDebug()
      })

      // Listen for requests for initial logs from the external window
      this.unlistenRequestLogs = await listen('request-initial-debug-logs', () => {
        console.log('[UI] Received request-initial-debug-logs')
        emit('initial-debug-logs', {
          logs: this.debugLogs.map((e) => this.safeIpcEntry(e) as DebugLogEntry),
          renderNewlines: this.debugRenderNewlines,
        }).catch((err) => {
          console.warn('[UI] Failed to emit initial-debug-logs:', err)
        })
      })

      // Listen for clear requests from the external window
      this.unlistenClearLogs = await listen('request-clear-debug-logs', () => {
        this.clearDebugLogs()
      })

      // Listen for toggle render newlines requests
      this.unlistenToggleRenderNewlines = await listen(
        'request-toggle-debug-render-newlines',
        () => {
          this.toggleDebugRenderNewlines()
        },
      )

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
      this.debugModalOpen = true
    } catch (err) {
      console.error('[UI] Error popping in debug window:', err)
    }
  }
}

export const debug = new DebugStore()
