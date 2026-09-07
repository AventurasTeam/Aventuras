import { isAndroid } from '$lib/utils/platform'

/**
 * Whether this platform can export or import a pack as a directory.
 *
 * Android has no folder picker at all -- `tauri-plugin-dialog` returns
 * `FolderPickerNotImplemented` there -- so the actions are hidden rather than left to fail.
 * The single-file `.prompt.json` export stays available on both.
 */
export function supportsDirectoryTransfer(): boolean {
  return !isAndroid()
}
