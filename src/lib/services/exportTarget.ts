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
import { isIos } from '#lib/utils/platform.ts'

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
  { timestamped = false }: { timestamped?: boolean } = {},
): Promise<SaveTarget | null> {
  const ios = isIos()
  const extensions = filters.flatMap((filter) => filter.extensions)
  const chosen = await save({
    defaultPath: ios && !timestamped ? withTimeOfDay(filename, new Date(), extensions) : filename,
    filters,
  })
  if (!chosen) return null
  if (ios && isFolderUrl(chosen)) {
    throw new Error('iOS saved the file under a different name. Export again to a new name.')
  }
  return { destPath: chosen }
}

/**
 * iOS exports a placeholder the app fills in afterwards. On a name clash, Keep Both hands back the
 * folder rather than the file and leaves the placeholder over the existing one, so iOS gets a name
 * that cannot clash.
 */
export function withTimeOfDay(filename: string, now: Date, extensions: string[] = []): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  // A filter's extension may have parts of its own, like `prompt.json`.
  const known = extensions.find((ext) => filename.endsWith(`.${ext}`))
  const dot = known ? filename.length - known.length - 1 : filename.lastIndexOf('.')
  return dot > 0 ? `${filename.slice(0, dot)}-${time}${filename.slice(dot)}` : `${filename}-${time}`
}

/** `YYYY-MM-DD` in local time, so it agrees with the time `withTimeOfDay` adds. */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isFolderUrl(destination: string): boolean {
  return destination.endsWith('/')
}
