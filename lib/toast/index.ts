// Imperative toast API. Reachable from anywhere — no context
// plumbing. Mount `<Toaster />` once at the app root for the
// queue to render.
//
// See [`docs/ui/patterns/toast.md`](../../docs/ui/patterns/toast.md)
// for severity / placement / dismiss / queue contract.

import { toastStore, type ToastOptions } from './store'

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    toastStore.show('success', message, options),
  error: (message: string, options?: ToastOptions) => toastStore.show('error', message, options),
  info: (message: string, options?: ToastOptions) => toastStore.show('info', message, options),
  warning: (message: string, options?: ToastOptions) =>
    toastStore.show('warning', message, options),
  dismiss: (id: string) => toastStore.dismiss(id),
}

export { toastStore } from './store'
export type { ToastAction, ToastItem, ToastOptions, ToastSeverity } from './store'
