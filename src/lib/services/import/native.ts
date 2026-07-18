/**
 * Importing a `.avt` from a file, without its images ever entering the JS heap.
 *
 * The heavy part of an `.avt` is the base64 in `embeddedImages`. Reading the file as text in JS
 * means the file contents and the parsed graph are both live at once, which on Android exceeds
 * the WebView's hard heap cap and kills the app. So the file is read natively instead:
 *
 * 1. Rust returns the JSON with the payloads stripped — small enough to parse here.
 * 2. The ordinary import runs on it, unchanged.
 * 3. Rust re-reads the file and streams the payloads into SQLite, using the mapping this side
 *    produced while importing.
 *
 * Structure stays in TypeScript, where it is tested; only the bytes move.
 */

import { invoke } from '@tauri-apps/api/core'
import type { AventuraExport, ImportResult, IdMaps } from './types'
import { runImport } from './index'
import { resolveImageMappings } from './images'

/**
 * Import a `.avt` from a path or Android SAF `content://` URI.
 *
 * Falls back to nothing: if the native side cannot read the file, the error surfaces as-is.
 * `runImport` deletes the partially imported story if the image pass fails.
 */
export async function importFromFile(filePath: string): Promise<ImportResult> {
  // Pass 1 — structure only. Rust skips each imageData without ever allocating it.
  const lightJson = await invoke<string>('avt_read_light', { srcPath: filePath })
  const data: AventuraExport = JSON.parse(lightJson)

  return runImport(data, {
    importImages: (parsed, maps) => importImagesNatively(filePath, parsed, maps),
  })
}

/**
 * Pass 2 — the payloads. Runs after the structure is committed, so the entries the image rows
 * reference already exist.
 */
async function importImagesNatively(
  filePath: string,
  data: AventuraExport,
  maps: IdMaps,
): Promise<void> {
  // Built from the light metadata: which images have a surviving entry, and which one.
  // Images whose entry was dropped are simply absent, so the native side never sees them.
  const mapping = resolveImageMappings(data, maps)
  if (mapping.length === 0) return

  await invoke<number>('avt_import_images', {
    srcPath: filePath,
    storyId: maps.newStoryId,
    mapping,
  })
}
