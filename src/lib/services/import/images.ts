/**
 * Embedded image import.
 *
 * The images are the only heavy part of an `.avt`: a story's base64 payloads dwarf its structure.
 * They are kept out of `structure.ts` so the payloads can travel by a different route than the
 * story graph — inline through the JS heap here, or natively for a large file.
 */

import { database } from '$lib/services/database'
import type { AventuraExport, IdMaps } from './types'

/** Old image id -> the imported entry it hangs off. Enough for a native importer to place a row. */
export interface ImageEntryMapping {
  oldImageId: string
  newEntryId: string
}

/**
 * Which images can actually be imported, and where they belong.
 *
 * An image whose entry is absent from the export is dropped: its row could not satisfy the
 * entry_id foreign key, and a missing picture is a better outcome than a failed import.
 */
export function resolveImageMappings(data: AventuraExport, maps: IdMaps): ImageEntryMapping[] {
  const mappings: ImageEntryMapping[] = []

  for (const image of data.embeddedImages ?? []) {
    const newEntryId = maps.oldToNewId.get(image.entryId)
    if (!newEntryId) {
      console.warn(`[Import] Skipping embedded image ${image.id}: entry ${image.entryId} not found`)
      continue
    }
    mappings.push({ oldImageId: image.id, newEntryId })
  }

  return mappings
}

/**
 * Insert the images carried inline in the parsed export.
 *
 * This holds every payload in the JS heap, which is what it costs to have them in a parsed
 * `AventuraExport` at all. Fine for the sync path and for ordinary files; the native importer
 * exists for the ones where it is not.
 */
export async function importImagesInline(data: AventuraExport, maps: IdMaps): Promise<void> {
  if (!data.embeddedImages) return

  const byId = new Map(data.embeddedImages.map((image) => [image.id, image]))

  for (const { oldImageId, newEntryId } of resolveImageMappings(data, maps)) {
    const image = byId.get(oldImageId)
    if (!image) continue

    // Image ids are deliberately NOT recorded in the id maps: nothing references an image by id,
    // and writing them into the map used for entry lookups could only ever corrupt it.
    await database.createEmbeddedImage({
      id: crypto.randomUUID(),
      storyId: maps.newStoryId,
      entryId: newEntryId,
      sourceText: image.sourceText,
      prompt: image.prompt,
      styleId: image.styleId,
      model: image.model,
      imageData: image.imageData,
      width: image.width,
      height: image.height,
      status: image.status,
      errorMessage: image.errorMessage,
    })
  }
}
