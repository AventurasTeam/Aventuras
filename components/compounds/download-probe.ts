import { spyOn } from 'storybook/test'

import { toastStore, type ToastItem } from '@/lib/toast'

// Play helpers for a web `.avts` export. Stories import this; app code never does.

/** Captures anchor downloads, the last Blob handed out and the toasts; `stop` restores all three. */
export function watchDownloads() {
  const downloads: string[] = []
  let blob: Blob | null = null
  let toasts: ToastItem[] = []
  const url = spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob
    return 'blob:story'
  })
  const click = spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download)
  })
  const unsubscribe = toastStore.subscribe((next) => {
    toasts = next
  })
  return {
    downloads,
    blob: () => blob,
    toasts: () => toasts.map((item) => [item.severity, item.message]),
    stop: () => {
      unsubscribe()
      url.mockRestore()
      click.mockRestore()
    },
  }
}
