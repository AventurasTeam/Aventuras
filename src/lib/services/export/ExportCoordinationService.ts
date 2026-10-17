/**
 * ExportCoordinationService - Gathers all story data in parallel for export.
 * Coordinates with the main exportService to provide complete story data.
 */

import { recordsForExport } from '#lib/services/stateTracking/index.ts'
import { database } from '#lib/services/database.ts'
import type {
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  TimeAnchor,
  WorldStateRecord,
  Entry,
  CheckpointRecord,
  Branch,
  EmbeddedImageMeta,
} from '#lib/types/index.ts'
import type { PackBindingExport } from '#lib/services/import/index.ts'

/** Complete story data for export */
export interface StoryExportData {
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  lorebookEntries: Entry[]
  // Metadata only (no base64): the native .avt exporter fills in imageData from SQLite, so the
  // heavy image bytes never load into the JS heap (which caused Android OOM on export).
  embeddedImages: EmbeddedImageMeta[]
  checkpoints: CheckpointRecord[]
  branches: Branch[]
  chapters: Chapter[]
  timeAnchors: TimeAnchor[]
  worldStateRecords: WorldStateRecord[]
  /**
   * The story's prompt pack, as much of it as can safely travel. Null when the story has no pack
   * row to point at (a story predating the column, or one whose pack has since been deleted) —
   * the file then records no pack and imports as a legacy file does.
   */
  packBinding: PackBindingExport | null
}

/**
 * Describe the story's pack for the file: identity, the story's own answers, and the shape of
 * the variables those answers belong to.
 *
 * Exported because sync needs exactly this section while keeping its own payload assembly (see
 * `syncService.exportStoryToJson`). It takes only a story id and reads only through `database`,
 * so it carries none of the `.avt` path's assumptions — in particular none about how image
 * payloads are gathered, which is the part the two exporters genuinely disagree about.
 *
 * Template content is deliberately absent. The recipient's own pack narrates on the recipient's
 * device, so a shared story cannot fork their templates behind their back; `.prompt.json` already
 * exists for sharing a pack deliberately.
 *
 * Definitions travel without ids: `id` and `packId` are assigned per device and would only invite
 * a later matcher to trust them.
 */
export async function gatherPackBinding(storyId: string): Promise<PackBindingExport | null> {
  const packId = await database.getStoryPackId(storyId)
  if (!packId) return null

  const pack = await database.getPack(packId)
  if (!pack) return null

  const [variables, runtimeVariables, customVariableValues] = await Promise.all([
    database.getPackVariables(packId),
    database.getRuntimeVariables(packId),
    database.getStoryCustomVariables(storyId),
  ])

  return {
    pack: { name: pack.name, author: pack.author },
    ...(customVariableValues ? { customVariableValues } : {}),
    variables: variables.map((v) => ({
      variableName: v.variableName,
      displayName: v.displayName,
      description: v.description,
      variableType: v.variableType,
      isRequired: v.isRequired,
      sortOrder: v.sortOrder,
      defaultValue: v.defaultValue,
      enumOptions: v.enumOptions,
    })),
    runtimeVariables: runtimeVariables.map((v) => ({
      entityType: v.entityType,
      variableName: v.variableName,
      displayName: v.displayName,
      description: v.description,
      variableType: v.variableType,
      defaultValue: v.defaultValue,
      minValue: v.minValue,
      maxValue: v.maxValue,
      enumOptions: v.enumOptions,
    })),
  }
}

/** Whether this device has State Tracking on, and since when; see `recordsForExport`. */
export interface ExportTracking {
  on: boolean
  enabledSince: number | null
}

/** Assumes tracking cannot be vouched for, which can only add a break. */
export const NOT_VOUCHED: ExportTracking = { on: false, enabledSince: null }

/**
 * Gather all story data in parallel for export.
 * @param storyId - The story ID to gather data for
 * @returns Complete story data ready for export
 */
export async function gatherStoryData(
  storyId: string,
  tracking: ExportTracking = NOT_VOUCHED,
): Promise<StoryExportData> {
  const [
    entries,
    characters,
    locations,
    items,
    storyBeats,
    lorebookEntries,
    embeddedImages,
    checkpoints,
    branches,
    chapters,
    packBinding,
    timeAnchors,
    worldStateRecords,
  ] = await Promise.all([
    database.getStoryEntries(storyId),
    database.getCharacters(storyId),
    database.getLocations(storyId),
    database.getItems(storyId),
    database.getStoryBeats(storyId),
    database.getEntries(storyId),
    database.getEmbeddedImageMetaForStory(storyId),
    database.getCheckpointRecords(storyId),
    database.getBranches(storyId),
    database.getChapters(storyId),
    gatherPackBinding(storyId),
    database.getTimeAnchors(storyId),
    database.getWorldStateRecordsForStory(storyId),
  ])

  return {
    entries,
    characters,
    locations,
    items,
    storyBeats,
    lorebookEntries,
    embeddedImages,
    checkpoints,
    branches,
    chapters,
    packBinding,
    timeAnchors,
    worldStateRecords: recordsForExport(worldStateRecords, tracking, Date.now()),
  }
}

export const exportCoordinationService = {
  gatherStoryData,
}
