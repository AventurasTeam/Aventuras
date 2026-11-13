import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { debugLog, type DebugLogEntry } from '#lib/stores/debugLog.ts'

export type { DebugLogEntry }

// The entries live in `debugLog`, which writers import directly; this store adds reactivity and
// the pop-out window on top.
class DebugStore {
  // Reactive signal that increments when logs change - UI can track this
  logsVersion = $state(0)
  debugModalOpen = $state(false)
  debugWindowActive = $state(false)
  debugRenderNewlines = $state(false)
  private unlistenPopIn: UnlistenFn | null = null
  private unlistenRequestLogs: UnlistenFn | null = null
  private unlistenClearLogs: UnlistenFn | null = null
  private unlistenToggleRenderNewlines: UnlistenFn | null = null
  /** See emitToDebugWindow: false from window creation until the window reports ready. */
  private debugWindowReady = false

  constructor() {
    debugLog.onChange((change) => {
      this.logsVersion++
      // Checked first: serialising an entry nobody is listening for is wasted work.
      if (change.kind === 'entry' && this.debugWindowReady) {
        this.emitToDebugWindow('debug-log-added', this.safeIpcEntry(change.entry))
      }
    })
  }

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
   * reflected in `debugLog`, which `initial-debug-logs` hands over in full.
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
    return debugLog.snapshot()
  }

  /**
   * Get current log count reactively.
   */
  get requestCount(): number {
    // touch logsVersion to make this reactive
    void this.logsVersion
    return debugLog.requestCount
  }

  /** Not reactive; callers already track `logsVersion`. */
  get logCount(): number {
    return debugLog.count
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
   * Clear all debug logs (session clear).
   */
  clearDebugLogs() {
    debugLog.reset()
    this.emitToDebugWindow('debug-logs-cleared', {})
  }

  /**
   * Pop-out window side: mirror what the main window sends, then ask it for the current log.
   * Returns the function that removes the listeners; never rejects.
   */
  async connectAsDebugWindow(): Promise<() => void> {
    const settled = await Promise.allSettled([
      listen<{ logs: DebugLogEntry[]; renderNewlines: boolean }>(
        'initial-debug-logs',
        ({ payload }) => {
          console.log('[DebugWin] Received initial-debug-logs', payload.logs.length)
          debugLog.reset(payload.logs)
          this.debugRenderNewlines = payload.renderNewlines
        },
      ),
      // The main window re-emits an entry each time it merges into it.
      listen<DebugLogEntry>('debug-log-added', ({ payload }) => {
        console.log('[DebugWin] Received debug-log-added', payload.id)
        debugLog.upsert(payload)
      }),
      listen('debug-logs-cleared', () => {
        console.log('[DebugWin] Received debug-logs-cleared')
        debugLog.reset()
      }),
      listen<boolean>('debug-render-newlines-changed', ({ payload }) => {
        console.log('[DebugWin] Received debug-render-newlines-changed', payload)
        this.debugRenderNewlines = payload
      }),
    ])

    const unlisteners = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const unlistenAll = () => unlisteners.forEach((unlisten) => unlisten())

    try {
      const failed = settled.find((r) => r.status === 'rejected')
      if (failed) throw failed.reason
      // Raw `emit`: `emitToDebugWindow` is gated on `debugWindowReady`, which only the main
      // window sets.
      console.log('[DebugWin] Emitting request-initial-debug-logs')
      await emit('request-initial-debug-logs')
    } catch (err) {
      console.error('[DebugWin] Failed to connect to the main window:', err)
      unlistenAll()
      return () => {}
    }
    return unlistenAll
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
        logs: debugLog.snapshot().map((e) => this.safeIpcEntry(e) as DebugLogEntry),
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
