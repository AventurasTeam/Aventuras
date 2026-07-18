import { isMobileDevice } from './swipe'

export interface DialogFilter {
  name: string
  extensions: string[]
}

/**
 * Filters for a native open dialog, made safe for Android.
 *
 * Android cannot filter by extension. The dialog plugin maps each one to a MIME type with
 * `MimeTypeMap.getMimeTypeFromExtension`, which returns null for anything the platform does not
 * recognise and then **drops it silently** — so a custom extension like `avt`, and the `*`
 * wildcard people reach for as an escape hatch, both vanish. What survives is the subset Android
 * happens to know, and the picker greys out everything else. `['avt', 'json', '*']` becomes
 * "JSON only": the wildcard does not widen anything, and no error says so.
 *
 * Passing no filters at all is what actually works: the plugin then falls through to an
 * unrestricted intent type and shows every file. That is strictly better than a filter that
 * lies, because the file the user needs is often the one Android cannot name — a `.avt`, or a
 * backup that SAF renamed to `backup.zip (1)` when resolving a duplicate, which is confirmed
 * unselectable on-device with a zip filter.
 *
 * Desktop has no such quirk, so it keeps the filters and their dropdown.
 */
export function openFilters(filters: DialogFilter[]): DialogFilter[] | undefined {
  return isMobileDevice() ? undefined : filters
}
