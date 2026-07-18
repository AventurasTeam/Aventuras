/**
 * Resolve where an export/backup file should be written.
 *
 * The save() dialog returns the destination on both platforms: a real path on desktop, a SAF
 * `content://` URI on Android. Callers pass that destination straight to the native export commands
 * (or plugin-fs for small text files), which write to it directly — on Android via the app's
 * content-URI file descriptor (ContentResolver). So the bytes are written once, natively, to the
 * user-chosen location: no temp file, no second copy, and nothing crosses the JS/IPC bridge.
 */

import { save } from '@tauri-apps/plugin-dialog'

export interface SaveFilter {
  name: string
  extensions: string[]
}

export interface SaveTarget {
  /** Where to write: a real path on desktop, a `content://` SAF URI on Android. */
  destPath: string
}

/**
 * Returns the chosen destination for `filename`, or null if the user cancelled the save dialog.
 */
export async function resolveSaveTarget(
  filename: string,
  filters: SaveFilter[],
): Promise<SaveTarget | null> {
  const chosen = await save({ defaultPath: filename, filters })
  return chosen ? { destPath: chosen } : null
}
