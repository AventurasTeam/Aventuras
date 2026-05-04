// Singleton Toast store. Custom emitter (instead of Zustand) keeps
// the surface tiny — three actions, one subscription primitive — and
// avoids pulling Zustand in for one consumer. Toaster mounts once at
// the app root, subscribes to changes, and renders the queue.

export type ToastSeverity = 'success' | 'error' | 'info'

export type ToastItem = {
  id: string
  severity: ToastSeverity
  message: string
}

const QUEUE_CAP = 3

type Listener = (toasts: ToastItem[]) => void

let toasts: ToastItem[] = []
const listeners = new Set<Listener>()
let nextId = 0

function notify() {
  for (const listener of listeners) listener(toasts)
}

function show(severity: ToastSeverity, message: string): string {
  // Stable per-process IDs are good enough for a transient queue;
  // we never persist or reconcile toasts across reloads.
  const id = `toast-${++nextId}`
  const item: ToastItem = { id, severity, message }

  // Cap-3 queue: when full, drop the oldest. The Toast component's
  // own auto-dismiss timer otherwise runs to completion; here we
  // unmount it ahead of schedule so the new arrival has a slot.
  if (toasts.length >= QUEUE_CAP) {
    toasts = [...toasts.slice(1), item]
  } else {
    toasts = [...toasts, item]
  }
  notify()
  return id
}

export const toastStore = {
  show,
  dismiss(id: string) {
    const next = toasts.filter((t) => t.id !== id)
    if (next.length === toasts.length) return
    toasts = next
    notify()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(toasts)
    return () => {
      listeners.delete(listener)
    }
  },
  // Test/reset helper — not exported via the public toast API.
  __reset() {
    toasts = []
    nextId = 0
    listeners.clear()
  },
}
