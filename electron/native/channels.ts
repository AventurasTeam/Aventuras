/**
 * The one spelling of every `native:` channel. Main and preload compile together,
 * so a literal typo on either side is a silent no-op the type system never sees:
 * the send lands on a channel nobody listens to and the answer never arrives.
 */
export const NATIVE_CHANNELS = {
  revealDbFile: 'native:reveal-db-file',
  setCloseGuard: 'native:set-close-guard',
  confirmClose: 'native:confirm-close',
  closeRequested: 'native:close-requested',
  confirmReload: 'native:confirm-reload',
  reloadRequested: 'native:reload-requested',
} as const
