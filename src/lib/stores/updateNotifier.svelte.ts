/**
 * Cross-component handle for the update dialog.
 *
 * The dialog is mounted once, in `AppShell`, but the two things that open it are far apart:
 * the startup check in `+page.svelte` and the "Check for Updates" button in the Interface
 * settings tab. A store is what lets both raise the same window without either of them
 * owning it.
 */

import type { UpdateInfo } from '$lib/services/updater'

class UpdateNotifier {
  /** Whether the dialog is showing. */
  open = $state(false)
  /** The update being offered. Never null while `open` is true. */
  info = $state<UpdateInfo | null>(null)

  /** Opens the dialog for an available update. Ignores a check that found nothing. */
  show(info: UpdateInfo) {
    if (!info.available) return
    this.info = info
    this.open = true
  }

  dismiss() {
    this.open = false
  }
}

export const updateNotifier = new UpdateNotifier()
