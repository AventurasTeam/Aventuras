import type { EmbeddedImageMeta } from '#lib/types/index.ts'

type ImageRow = Pick<EmbeddedImageMeta, 'id' | 'status'>

/** A row whose pixels are still being produced, so there is nothing to fetch yet. */
export function isImageInProgress(image: Pick<EmbeddedImageMeta, 'status'>): boolean {
  return image.status === 'pending' || image.status === 'generating'
}

/** What a reload changed: rows that are gone, and rows that kept their id but changed status. */
export function diffGalleryImages(
  previous: readonly ImageRow[],
  next: readonly ImageRow[],
): { removed: string[]; statusChanged: string[] } {
  const nextStatus = new Map(next.map((image) => [image.id, image.status]))
  const removed: string[] = []
  const statusChanged: string[] = []
  for (const { id, status } of previous) {
    const now = nextStatus.get(id)
    if (now === undefined) removed.push(id)
    else if (now !== status) statusChanged.push(id)
  }
  return { removed, statusChanged }
}
