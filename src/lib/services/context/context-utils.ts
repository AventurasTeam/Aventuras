/**
 * Shared context utility functions used across all mapper modules.
 *
 * These are pure transformation helpers extracted to avoid duplication
 * between classifierMapper, imageMapper, and worldStateMapper.
 */

/**
 * Normalize appearance data from a character's visualDescriptors metadata field.
 *
 * Handles two historical formats:
 * - Legacy array: string[] — each element is an appearance descriptor
 * - Object format: { face, hair, eyes, build, clothing, accessories, distinguishing }
 *
 * @param visualDescriptors - Raw value from RelevantEntry.metadata.visualDescriptors
 * @returns Array of non-empty appearance descriptor strings
 */
export function normalizeAppearance(visualDescriptors: unknown): string[] {
  if (!visualDescriptors) return []

  if (Array.isArray(visualDescriptors)) {
    return (visualDescriptors as unknown[]).filter(Boolean).map(String)
  }

  if (typeof visualDescriptors === 'object') {
    const vd = visualDescriptors as Record<string, unknown>
    const fields = ['face', 'hair', 'eyes', 'build', 'clothing', 'accessories', 'distinguishing']
    const parts: string[] = []
    for (const field of fields) {
      if (vd[field]) parts.push(String(vd[field]))
    }
    return parts
  }

  return []
}
