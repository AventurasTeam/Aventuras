/**
 * Writes an imported story's structure: the story row, branches, entries, world state,
 * checkpoints and chapters. Everything except the embedded image payloads, which are handled
 * separately so that the heavy base64 can take a different route (see `images.ts`).
 */

import { database } from '$lib/services/database'
import type {
  Story,
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  Entry,
  Branch,
} from '$lib/types'
import type { AventuraExport, IdMaps } from './types'
import { createMappers } from './idMaps'

export interface ImportStructureOptions {
  /** Sync keeps the original title; a user-facing import marks the copy. */
  skipImportedSuffix?: boolean
}

/**
 * Insert everything but the images. Assumes `maps` was built from the same `data`.
 */
export async function importStructure(
  data: AventuraExport,
  maps: IdMaps,
  options: ImportStructureOptions = {},
): Promise<void> {
  const { newStoryId, oldToNewId, branchIdMap, checkpointIdMap } = maps
  const { mapBranchId, mapEntryId, mapOverridesId, remapEntityId } = createMappers(maps)
  const { skipImportedSuffix = false } = options

  const importedStory: Omit<Story, 'createdAt' | 'updatedAt'> = {
    id: newStoryId,
    title: skipImportedSuffix ? data.story.title : `${data.story.title} (Imported)`,
    description: data.story.description,
    genre: data.story.genre,
    templateId: data.story.templateId,
    mode: data.story.mode || 'adventure',
    settings: data.story.settings,
    memoryConfig: data.story.memoryConfig || null,
    retryState: null, // Clear retry state on import
    styleReviewState: data.styleReviewState ?? null, // Restore style review state from export (v1.2.0+)
    timeTracker: data.story.timeTracker ?? null, // Restore time tracker from export
    currentBranchId: null, // Set after branch import (if available)
    currentBgImage: data.story.currentBgImage || null,
  }

  await database.createStory(importedStory)

  // Branches: parents must exist before children, so insert topologically rather than in
  // array order. Checkpoint links are recorded now and applied once checkpoints exist.
  const branchCheckpointMap = new Map<string, string | null>()
  if (data.branches && data.branches.length > 0) {
    const insertBranch = async (branch: Branch, parentBranchId: string | null) => {
      const newBranchId = branchIdMap.get(branch.id)
      if (!newBranchId) return
      await database.addBranch({
        id: newBranchId,
        storyId: newStoryId,
        name: branch.name,
        parentBranchId,
        forkEntryId: mapEntryId(branch.forkEntryId) ?? branch.forkEntryId,
        checkpointId: null,
        createdAt: branch.createdAt,
        snapshotComplete: branch.snapshotComplete ?? false,
      })
      const mappedCheckpointId = branch.checkpointId
        ? (checkpointIdMap.get(branch.checkpointId) ?? null)
        : null
      branchCheckpointMap.set(newBranchId, mappedCheckpointId)
    }

    const pending = [...data.branches]
    const inserted = new Set<string>()
    let progress = true

    while (pending.length > 0 && progress) {
      progress = false
      for (let i = pending.length - 1; i >= 0; i--) {
        const branch = pending[i]
        const newBranchId = branchIdMap.get(branch.id)
        if (!newBranchId) {
          pending.splice(i, 1)
          continue
        }

        const mappedParentId = branch.parentBranchId
          ? (branchIdMap.get(branch.parentBranchId) ?? null)
          : null
        if (mappedParentId && !inserted.has(mappedParentId)) {
          continue
        }

        await insertBranch(branch, mappedParentId)
        inserted.add(newBranchId)
        pending.splice(i, 1)
        progress = true
      }
    }

    // Anything left has an unresolvable parent (a cycle, or a parent missing from the export).
    // Insert it parentless rather than dropping the branch entirely.
    for (const branch of pending) {
      await insertBranch(branch, null)
    }
  }

  for (const entry of data.entries) {
    const newEntryId = oldToNewId.get(entry.id) ?? crypto.randomUUID()

    await database.addStoryEntry({
      id: newEntryId,
      storyId: newStoryId,
      type: entry.type,
      content: entry.content,
      parentId: entry.parentId ? (oldToNewId.get(entry.parentId) ?? null) : null,
      position: entry.position,
      metadata: entry.metadata,
      branchId: mapBranchId(entry.branchId ?? null),
      translatedContent: entry.translatedContent ?? null,
      translationLanguage: entry.translationLanguage ?? null,
      originalInput: entry.originalInput ?? null,
    })
  }

  for (const char of data.characters ?? []) {
    const newCharId = oldToNewId.get(char.id) ?? crypto.randomUUID()

    await database.addCharacter({
      id: newCharId,
      storyId: newStoryId,
      name: char.name,
      description: char.description,
      relationship: char.relationship,
      traits: char.traits,
      status: char.status,
      metadata: char.metadata,
      visualDescriptors: char.visualDescriptors ?? {},
      portrait: char.portrait ?? null,
      branchId: mapBranchId(char.branchId ?? null),
      overridesId: mapOverridesId(char.overridesId),
      deleted: char.deleted ?? false,
      translatedName: char.translatedName ?? null,
      translatedDescription: char.translatedDescription ?? null,
      translatedRelationship: char.translatedRelationship ?? null,
      translatedTraits: char.translatedTraits ?? null,
      translatedVisualDescriptors: char.translatedVisualDescriptors ?? null,
      translationLanguage: char.translationLanguage ?? null,
    })
  }

  for (const loc of data.locations ?? []) {
    const newLocId = oldToNewId.get(loc.id) ?? crypto.randomUUID()

    await database.addLocation({
      id: newLocId,
      storyId: newStoryId,
      name: loc.name,
      description: loc.description,
      visited: loc.visited,
      current: loc.current,
      connections: loc.connections.map((c) => oldToNewId.get(c) ?? c),
      metadata: loc.metadata,
      branchId: mapBranchId(loc.branchId ?? null),
      overridesId: mapOverridesId(loc.overridesId),
      deleted: loc.deleted ?? false,
      translatedName: loc.translatedName ?? null,
      translatedDescription: loc.translatedDescription ?? null,
      translationLanguage: loc.translationLanguage ?? null,
    })
  }

  for (const item of data.items ?? []) {
    const newItemId = oldToNewId.get(item.id) ?? crypto.randomUUID()

    // 'inventory' is a sentinel, not an id: it must survive remapping untouched.
    const mappedLocation =
      item.location === 'inventory' ? 'inventory' : (oldToNewId.get(item.location) ?? item.location)

    await database.addItem({
      id: newItemId,
      storyId: newStoryId,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      equipped: item.equipped,
      location: mappedLocation,
      metadata: item.metadata,
      branchId: mapBranchId(item.branchId ?? null),
      overridesId: mapOverridesId(item.overridesId),
      deleted: item.deleted ?? false,
      translatedName: item.translatedName ?? null,
      translatedDescription: item.translatedDescription ?? null,
      translationLanguage: item.translationLanguage ?? null,
    })
  }

  for (const beat of data.storyBeats ?? []) {
    const newBeatId = oldToNewId.get(beat.id) ?? crypto.randomUUID()

    await database.addStoryBeat({
      id: newBeatId,
      storyId: newStoryId,
      title: beat.title,
      description: beat.description,
      type: beat.type,
      status: beat.status,
      triggeredAt: beat.triggeredAt,
      resolvedAt: beat.resolvedAt ?? null,
      metadata: beat.metadata,
      branchId: mapBranchId(beat.branchId ?? null),
      overridesId: mapOverridesId(beat.overridesId),
      deleted: beat.deleted ?? false,
      translatedTitle: beat.translatedTitle ?? null,
      translatedDescription: beat.translatedDescription ?? null,
      translationLanguage: beat.translationLanguage ?? null,
    })
  }

  // Lorebook entries (added in v1.1.0)
  for (const entry of data.lorebookEntries ?? []) {
    const newEntryId = oldToNewId.get(entry.id) ?? crypto.randomUUID()

    await database.addEntry({
      id: newEntryId,
      storyId: newStoryId,
      name: entry.name,
      type: entry.type,
      description: entry.description,
      hiddenInfo: entry.hiddenInfo,
      aliases: entry.aliases || [],
      state: entry.state,
      adventureState: entry.adventureState,
      creativeState: entry.creativeState,
      injection: entry.injection,
      firstMentioned: entry.firstMentioned
        ? (oldToNewId.get(entry.firstMentioned) ?? entry.firstMentioned)
        : null,
      lastMentioned: entry.lastMentioned
        ? (oldToNewId.get(entry.lastMentioned) ?? entry.lastMentioned)
        : null,
      mentionCount: entry.mentionCount || 0,
      createdBy: entry.createdBy || 'import',
      createdAt: entry.createdAt || Date.now(),
      updatedAt: Date.now(),
      loreManagementBlacklisted: entry.loreManagementBlacklisted || false,
      branchId: mapBranchId(entry.branchId ?? null),
      overridesId: mapOverridesId(entry.overridesId),
      deleted: entry.deleted ?? false,
    })
  }

  // Checkpoints (added in v1.6.0). Their snapshots are whole entity graphs, each needing the
  // same remapping as the live rows above.
  if (data.checkpoints) {
    const remapStoryEntry = (entry: StoryEntry): StoryEntry => ({
      ...entry,
      id: remapEntityId(entry.id),
      storyId: newStoryId,
      parentId: entry.parentId ? (remapEntityId(entry.parentId) ?? entry.parentId) : null,
      branchId: mapBranchId(entry.branchId ?? null),
    })
    const remapCharacter = (char: Character): Character => ({
      ...char,
      id: remapEntityId(char.id),
      storyId: newStoryId,
      branchId: mapBranchId(char.branchId ?? null),
    })
    const remapLocation = (loc: Location): Location => ({
      ...loc,
      id: remapEntityId(loc.id),
      storyId: newStoryId,
      branchId: mapBranchId(loc.branchId ?? null),
      connections: loc.connections.map((id) => oldToNewId.get(id) ?? id),
    })
    const remapItem = (item: Item): Item => ({
      ...item,
      id: remapEntityId(item.id),
      storyId: newStoryId,
      branchId: mapBranchId(item.branchId ?? null),
      location:
        item.location === 'inventory'
          ? 'inventory'
          : (oldToNewId.get(item.location) ?? item.location),
    })
    const remapStoryBeat = (beat: StoryBeat): StoryBeat => ({
      ...beat,
      id: remapEntityId(beat.id),
      storyId: newStoryId,
      branchId: mapBranchId(beat.branchId ?? null),
    })
    const remapChapter = (chapter: Chapter): Chapter => ({
      ...chapter,
      id: remapEntityId(chapter.id),
      storyId: newStoryId,
      startEntryId: remapEntityId(chapter.startEntryId),
      endEntryId: remapEntityId(chapter.endEntryId),
      branchId: mapBranchId(chapter.branchId ?? null),
    })
    const remapLorebookEntry = (entry: Entry): Entry => ({
      ...entry,
      id: remapEntityId(entry.id),
      storyId: newStoryId,
      branchId: mapBranchId(entry.branchId ?? null),
      firstMentioned: entry.firstMentioned
        ? (oldToNewId.get(entry.firstMentioned) ?? entry.firstMentioned)
        : null,
      lastMentioned: entry.lastMentioned
        ? (oldToNewId.get(entry.lastMentioned) ?? entry.lastMentioned)
        : null,
    })

    for (const checkpoint of data.checkpoints) {
      const newCheckpointId = checkpointIdMap.get(checkpoint.id) ?? crypto.randomUUID()
      checkpointIdMap.set(checkpoint.id, newCheckpointId)

      await database.createCheckpoint({
        id: newCheckpointId,
        storyId: newStoryId,
        name: checkpoint.name,
        lastEntryId: remapEntityId(checkpoint.lastEntryId),
        lastEntryPreview: checkpoint.lastEntryPreview,
        entryCount: checkpoint.entryCount,
        entriesSnapshot: checkpoint.entriesSnapshot.map(remapStoryEntry),
        charactersSnapshot: checkpoint.charactersSnapshot.map(remapCharacter),
        locationsSnapshot: checkpoint.locationsSnapshot.map(remapLocation),
        itemsSnapshot: checkpoint.itemsSnapshot.map(remapItem),
        storyBeatsSnapshot: checkpoint.storyBeatsSnapshot.map(remapStoryBeat),
        chaptersSnapshot: checkpoint.chaptersSnapshot.map(remapChapter),
        timeTrackerSnapshot: checkpoint.timeTrackerSnapshot,
        lorebookEntriesSnapshot: checkpoint.lorebookEntriesSnapshot
          ? checkpoint.lorebookEntriesSnapshot.map(remapLorebookEntry)
          : undefined,
        createdAt: checkpoint.createdAt ?? Date.now(),
      })
    }
  }

  // Branch -> checkpoint links, now that the checkpoints they point at exist.
  for (const [branchId, checkpointId] of branchCheckpointMap.entries()) {
    if (checkpointId) {
      await database.updateBranch(branchId, { checkpointId })
    }
  }

  if (data.story.currentBranchId) {
    const mappedCurrentBranch = branchIdMap.get(data.story.currentBranchId) ?? null
    if (mappedCurrentBranch) {
      await database.setStoryCurrentBranch(newStoryId, mappedCurrentBranch)
    }
  }

  // Chapters (added in v1.7.0)
  for (const chapter of data.chapters ?? []) {
    // Pre-mapped, so this id matches the one checkpoint snapshots above already used.
    const newChapterId = oldToNewId.get(chapter.id) ?? crypto.randomUUID()

    await database.addChapter({
      id: newChapterId,
      storyId: newStoryId,
      number: chapter.number,
      title: chapter.title,
      startEntryId: oldToNewId.get(chapter.startEntryId) ?? chapter.startEntryId,
      endEntryId: oldToNewId.get(chapter.endEntryId) ?? chapter.endEntryId,
      entryCount: chapter.entryCount,
      summary: chapter.summary,
      startTime: chapter.startTime,
      endTime: chapter.endTime,
      keywords: chapter.keywords,
      characters: chapter.characters,
      locations: chapter.locations,
      plotThreads: chapter.plotThreads,
      emotionalTone: chapter.emotionalTone,
      branchId: chapter.branchId ? (branchIdMap.get(chapter.branchId) ?? null) : null,
      createdAt: chapter.createdAt,
    })
  }
}
