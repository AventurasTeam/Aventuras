// Imperative toast API. Reachable from anywhere — no context
// plumbing. Mount `<Toaster />` once at the app root for the
// queue to render.
//
// See [`docs/ui/patterns/toast.md`](../../docs/ui/patterns/toast.md)
// for severity / placement / dismiss / queue contract.

import { toastStore } from './store'

export const toast = {
  success: (message: string) => toastStore.show('success', message),
  error: (message: string) => toastStore.show('error', message),
  info: (message: string) => toastStore.show('info', message),
  dismiss: (id: string) => toastStore.dismiss(id),
}

export type { ToastItem, ToastSeverity } from './store'
