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
import type {
  CustomVariableType,
  EnumOption,
  RuntimeEntityType,
  RuntimeVariableType,
} from '$lib/services/packs/types'

/**
 * A pack variable definition as it travels in a `.avt`.
 *
 * Deliberately id-less: `CustomVariable.id` and `packId` are assigned per device, so carrying
 * them off-device would only invite someone to match on them later. Matching is by name.
 */
export interface PackVariableExport {
  variableName: string
  displayName: string
  description?: string
  variableType: CustomVariableType
  isRequired: boolean
  sortOrder: number
  defaultValue?: string
  enumOptions?: EnumOption[]
}

/** A pack runtime-variable definition as it travels in a `.avt`. Id-less, for the same reason. */
export interface PackRuntimeVariableExport {
  entityType: RuntimeEntityType
  variableName: string
  displayName: string
  description?: string
  variableType: RuntimeVariableType
  defaultValue?: string
  minValue?: number
  maxValue?: number
  enumOptions?: EnumOption[]
}

/**
 * What a story file records about the prompt pack it was written with.
 *
 * Enough for a recipient to re-establish the binding — identity, the story's own answers, and
 * the shape of the variables those answers belong to — and deliberately *not* the pack's
 * template content. Templates stay owned by the pack as installed on the device that generates,
 * so receiving a story can never fork the recipient's packs behind their back.
 */
export interface PackBindingExport {
  pack: { name: string; author: string | null }
  customVariableValues?: Record<string, string>
  variables?: PackVariableExport[]
  runtimeVariables?: PackRuntimeVariableExport[]
}

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
  packBinding?: PackBindingExport // Added in v1.9.0
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
 * - v1.9.0 Added packBinding (prompt pack identity, the story's variable answers, and the
 *          pack's variable definitions — never its template content)
 */
export const EXPORT_FORMAT_VERSION = '1.9.0'

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
