/**
 * Story import.
 *
 * Split so that the *structure* of an import (id remapping, insertion order, foreign keys) has
 * exactly one implementation, while the *image payloads* can arrive by more than one route:
 * inline through the JS heap for the sync path and ordinary files, or streamed natively for a
 * large `.avt` whose base64 would not fit in the WebView heap.
 */

import { database } from '$lib/services/database'
import { errMessage } from '$lib/utils/error'
import type { AventuraExport, ImportResult, IdMaps } from './types'
import { validateExport, logVersionCompatibilityWarnings } from './validate'
import { buildIdMaps } from './idMaps'
import { importStructure } from './structure'
import type { StoryPackBinding } from './structure'
import { importImagesInline } from './images'
import { autoMatchPackBinding, buildBindingContext } from './packBinding'
import type { PackBindingContext, PackBindingResolution } from './packBinding'

export type { AventuraExport, ImportResult, IdMaps, PackBindingExport } from './types'
export { EXPORT_FORMAT_VERSION } from './types'
export { validateExport, logVersionCompatibilityWarnings, compareVersions } from './validate'
export { buildIdMaps, createMappers } from './idMaps'
export { importStructure } from './structure'
export type { StoryPackBinding } from './structure'
export { importImagesInline, resolveImageMappings } from './images'
export type { ImageEntryMapping } from './images'
export { importFromFile } from './native'
export {
  autoMatchPackBinding,
  buildBindingContext,
  canonicalizeCustomVariableValues,
  customVariableValue,
  decidePackPrompt,
  mergeCustomVariableValues,
  planPackBinding,
  sanitizePackBinding,
  unansweredRequiredVariables,
} from './packBinding'
export type {
  PackBindingContext,
  PackBindingResolution,
  PackPromptDecision,
  PackPromptPlan,
  RequiredVariableDef,
  SanitizedPackBinding,
} from './packBinding'

export interface RunImportOptions {
  /** Sync keeps the original title; a user-facing import marks the copy. */
  skipImportedSuffix?: boolean
  /**
   * How the image payloads get in. Runs after the structure is committed, so the entries its
   * rows reference already exist. Defaults to the inline path.
   */
  importImages?: (data: AventuraExport, maps: IdMaps) => Promise<void>
  /**
   * Which local pack the story binds to. Called before anything is written, so returning `null`
   * (the user cancelled) leaves nothing behind.
   *
   * Defaults to the headless auto-matcher, which is what makes sync correct without a code path
   * of its own — and what keeps the pipeline UI-agnostic, since the only caller that can ask a
   * question is the one that supplies this.
   */
  resolvePackBinding?: (ctx: PackBindingContext) => Promise<PackBindingResolution | null>
}

/**
 * Import a parsed export. The story is created first and images last, because an image row
 * cannot satisfy its entry_id foreign key before the entries exist.
 *
 * If anything fails after the story row is written, the story is deleted again: a half-imported
 * story is worse than none, and the delete cascades to whatever was already inserted. The
 * structure and the images cannot share a transaction — a native image importer writes over its
 * own connection — so this compensating delete is what stands in for one.
 */
export async function runImport(
  data: AventuraExport,
  options: RunImportOptions = {},
): Promise<ImportResult> {
  const {
    skipImportedSuffix = false,
    importImages = importImagesInline,
    resolvePackBinding = autoMatchPackBinding,
  } = options

  const invalid = validateExport(data)
  if (invalid) return { success: false, error: invalid }

  let storyCreated = false
  let maps: IdMaps | null = null

  try {
    logVersionCompatibilityWarnings(data)

    // Before the first write: a cancel here costs nothing to undo, and the story never exists
    // bound to a pack the user did not pick.
    const context = await buildBindingContext(data.packBinding)
    const resolution = await resolvePackBinding(context)
    if (!resolution) return { success: false }

    const packBinding = await loadTargetDefinitions(context, resolution)
    maps = buildIdMaps(data)
    await importStructure(data, maps, {
      skipImportedSuffix,
      packBinding,
      onStoryCreated: () => {
        storyCreated = true
      },
    })
    await importImages(data, maps)
    return { success: true, storyId: maps.newStoryId }
  } catch (error) {
    console.error('Import failed:', error)
    if (storyCreated && maps) await rollbackStory(maps.newStoryId)
    return { success: false, error: errMessage(error) }
  }
}

/**
 * Pair the resolved pack's runtime variable definitions with the file's, so the entity values can
 * be re-keyed as their rows are built.
 *
 * Skipped entirely when the file carries no runtime variable definitions — the overwhelmingly
 * common case, and one extra query is one too many on a path that runs per import.
 */
async function loadTargetDefinitions(
  context: PackBindingContext,
  resolution: PackBindingResolution,
): Promise<StoryPackBinding> {
  const sourceRuntimeVars = context.binding?.runtimeVariables ?? []
  const targetRuntimeVars = sourceRuntimeVars.length
    ? await database.getRuntimeVariables(resolution.packId)
    : []

  return { ...resolution, sourceRuntimeVars, targetRuntimeVars }
}

/**
 * Undo a partial import. Best-effort: the import has already failed, and reporting a cleanup
 * problem instead of the real cause would only hide it.
 */
async function rollbackStory(storyId: string): Promise<void> {
  try {
    await database.deleteStory(storyId)
  } catch (cleanupError) {
    console.error('[Import] Failed to roll back the partially imported story:', cleanupError)
  }
}

/** Parse and validate a sync payload before any replacement work begins. */
export async function previewImport(
  content: string,
): Promise<{ context: PackBindingContext } | { error: string }> {
  let data: AventuraExport
  try {
    data = JSON.parse(content)
  } catch {
    return { error: 'Invalid file: Not a valid JSON file.' }
  }

  const invalid = validateExport(data)
  if (invalid) return { error: invalid }

  try {
    return { context: await buildBindingContext(data.packBinding) }
  } catch (error) {
    return { error: errMessage(error) }
  }
}

/**
 * Import from a JSON string. Used by the file-input path and by sync, which receives a story
 * over the network as text.
 */
export async function importFromJson(
  content: string,
  options: RunImportOptions = {},
): Promise<ImportResult> {
  let data: AventuraExport
  try {
    data = JSON.parse(content)
  } catch {
    return {
      success: false,
      error:
        'Invalid file: Not a valid JSON file. Please select an Aventura story file (.avt or .json).',
    }
  }

  return runImport(data, options)
}
