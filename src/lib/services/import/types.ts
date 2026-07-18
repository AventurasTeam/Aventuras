/**
 * The `.avt` file format.
 *
 * This lives here rather than next to the exporter because both the exporter and the importer
 * depend on it, and the importer must not depend on the exporter. `export.ts` re-exports
 * `AventuraExport` so existing importers of the type keep working.
 */

import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  Entry,
  Checkpoint,
  Branch,
  PersistentStyleReviewState,
  EmbeddedImage,
} from '$lib/types'

export interface AventuraExport {
  version: string
  exportedAt: number
  story: Story
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  lorebookEntries?: Entry[] // Added in v1.1.0
  styleReviewState?: PersistentStyleReviewState | null // Added in v1.2.0
  // Note: story.timeTracker added in v1.3.0
  embeddedImages?: EmbeddedImage[] // Added in v1.4.0
  checkpoints?: Checkpoint[] // Added in v1.6.0
  branches?: Branch[] // Added in v1.6.0
  chapters?: Chapter[] // Added in v1.7.0
  currentBgImage?: string | null // Added in v1.8.0
}

/**
 * Versions the .avt FILE FORMAT. Unrelated to the application version in package.json — the two
 * have always advanced independently.
 *
 * Bump it whenever a field is added to AventuraExport, and add the matching check to
 * `logVersionCompatibilityWarnings`, or files this app writes will be stamped as older than their
 * own contents and warn spuriously on re-import.
 *
 * Version history:
 * - v1.0.0 Initial release
 * - v1.1.0 Added lorebookEntries
 * - v1.2.0 Added styleReviewState
 * - v1.3.0 Added timeTracker to story, entry metadata (timeStart/timeEnd)
 * - v1.4.0 Added embeddedImages (generated images embedded in story entries)
 * - v1.5.0 Added character portraits
 * - v1.6.0 Added checkpoints and branches
 * - v1.7.0 Added chapters (memory system)
 * - v1.8.0 Added currentBgImage (carried on the story record)
 */
export const EXPORT_FORMAT_VERSION = '1.8.0'

export interface ImportResult {
  success: boolean
  storyId?: string
  error?: string
}

/** The id translation tables built once up front and used by the whole import. */
export interface IdMaps {
  newStoryId: string
  /** Old id -> new id, for entries, world-state entities and chapters. */
  oldToNewId: Map<string, string>
  branchIdMap: Map<string, string>
  checkpointIdMap: Map<string, string>
}
