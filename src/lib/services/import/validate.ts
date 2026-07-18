/** Shape checks and version warnings for an incoming `.avt`. */

import type { AventuraExport } from './types'

/**
 * Compare semantic versions. Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const partA = partsA[i] ?? 0
    const partB = partsB[i] ?? 0
    if (partA !== partB) return partA - partB
  }
  return 0
}

/**
 * Check that the parsed object is an Aventura export we can import.
 * Returns a user-facing error message, or null when the file is usable.
 */
export function validateExport(data: AventuraExport): string | null {
  if (!data.version || !data.story || !data.entries) {
    return 'Invalid file format: This does not appear to be an Aventura story file. Missing required fields (version, story, or entries).'
  }
  if (data.entries.length === 0) {
    return 'Invalid story file: The file contains no story entries.'
  }
  return null
}

/** Features added per format version, used to warn about what an older file cannot carry. */
const FEATURE_HISTORY: { version: string; warning: string }[] = [
  { version: '1.1.0', warning: 'lorebook entries (v1.1.0). Lorebook will be empty.' },
  {
    version: '1.2.0',
    warning: 'style review state (v1.2.0). Style analysis history will be empty.',
  },
  { version: '1.3.0', warning: 'time tracking (v1.3.0). Time tracker will start at zero.' },
  {
    version: '1.4.0',
    warning: 'embedded images (v1.4.0). Generated images will not be restored.',
  },
  {
    version: '1.5.0',
    warning: 'character portraits (v1.5.0). Character portraits will not be restored.',
  },
  {
    version: '1.6.0',
    warning: 'branching data (v1.6.0). Branches and checkpoints will not be restored.',
  },
  {
    version: '1.7.0',
    warning: 'chapters (v1.7.0). Chapter summaries (memory) will not be restored.',
  },
  {
    version: '1.8.0',
    warning: 'current background image (v1.8.0). Current background image will not be restored.',
  },
]

/** Log warnings for imports from older versions that may be missing features. */
export function logVersionCompatibilityWarnings(importVersion: string): void {
  for (const { version, warning } of FEATURE_HISTORY) {
    if (compareVersions(importVersion, version) < 0) {
      console.warn(`[Import] File from v${importVersion} predates ${warning}`)
    }
  }
}
