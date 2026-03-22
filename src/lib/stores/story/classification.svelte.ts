import type { ClassificationResult } from '$lib/services/ai/generation'
import { extractInlineCustomVars } from '$lib/services/ai/sdk/schemas/runtime-variables'
import { database } from '$lib/services/database'
import { emitStateUpdated } from '$lib/services/events'
import type { RuntimeVariable } from '$lib/services/packs/types'
import type {
  Character,
  CharacterBeforeState,
  ItemBeforeState,
  LocationBeforeState,
  StoryBeatBeforeState,
  TimeTracker,
  Location,
  Item,
  StoryBeat,
  WorldStateDelta,
} from '$lib/types'
import { settings } from '../settings.svelte'
import { ui } from '../ui.svelte'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Classification]', ...args)
  }
}

/**
 * Merge LLM-extracted inline runtime vars into entity metadata.runtimeVars.
 * Values are keyed by defId (RuntimeVariable.id), NOT variableName,
 * so renames only change the definition -- stored values follow automatically.
 *
 * @param existingMetadata - Current entity metadata (may be null)
 * @param inlineVars - LLM-extracted vars keyed by variableName (from extractInlineCustomVars)
 * @param defsByName - Lookup from variableName to RuntimeVariable definition
 * @returns Updated metadata with runtimeVars merged
 */
function mergeRuntimeVars(
  existingMetadata: Record<string, unknown> | null,
  inlineVars: Record<string, unknown> | undefined,
  defsByName: Map<string, RuntimeVariable>,
): Record<string, unknown> {
  if (!inlineVars || Object.keys(inlineVars).length === 0) {
    return existingMetadata ?? {}
  }

  const base = existingMetadata ?? {}
  const runtimeVars = { ...((base.runtimeVars as Record<string, unknown>) ?? {}) }

  for (const [key, value] of Object.entries(inlineVars)) {
    const def = defsByName.get(key)
    if (def) {
      runtimeVars[def.id] = { variableName: def.variableName, v: value }
    }
  }

  return { ...base, runtimeVars }
}

export class StoryClassification {
  constructor(private story: StoryStore) {}

  /**
   * Helper to wrap entity updates in try-catch with toast notifications.
   * Prevents database errors from breaking the entire classification pipeline.
   */
  private classificationErrors = 0

  private async wrapUpdate(label: string, entityName: string, fn: () => Promise<void>) {
    try {
      await fn()
      this.classificationErrors = 0
    } catch (err) {
      this.classificationErrors++
      console.error(`[StoryStore-Classification] ${label} failed for ${entityName}:`, err)
      ui.showToast(`${label} failed: ${entityName}`, 'warning')
      if (this.classificationErrors >= 3) {
        const count = this.classificationErrors
        this.classificationErrors = 0
        throw new Error(`Classification pipeline aborted after ${count} consecutive failures`)
      }
    }
  }

  /**
   * Apply classification results to update world state.
   * This is Phase 4 of the processing pipeline per design doc.
   */
  async applyClassificationResult(result: ClassificationResult, entryId?: string): Promise<void> {
    if (!this.story.id) {
      log('applyClassificationResult: No story loaded, skipping')
      return
    }

    log('applyClassificationResult called', {
      characterUpdates: result.entryUpdates.characterUpdates.length,
      locationUpdates: result.entryUpdates.locationUpdates.length,
      itemUpdates: result.entryUpdates.itemUpdates.length,
      storyBeatUpdates: result.entryUpdates.storyBeatUpdates.length,
      newCharacters: result.entryUpdates.newCharacters.length,
      newLocations: result.entryUpdates.newLocations.length,
      newItems: result.entryUpdates.newItems.length,
      newStoryBeats: result.entryUpdates.newStoryBeats.length,
      scene: result.scene,
    })

    const storyId = this.story.id!
    const trackingEnabled = settings.experimentalFeatures.stateTracking && !!entryId

    // Extract runtime variable definitions attached by ClassifierService (if any)
    const runtimeVarDefs: RuntimeVariable[] | undefined = result._runtimeVarDefs
    const defsByName = new Map<string, RuntimeVariable>(
      runtimeVarDefs?.map((d) => [d.variableName, d]) ?? [],
    )

    // Phase 1: Capture before-state for entities that will be modified
    const charactersBefore: CharacterBeforeState[] = []
    const locationsBefore: LocationBeforeState[] = []
    const itemsBefore: ItemBeforeState[] = []
    const storyBeatsBefore: StoryBeatBeforeState[] = []
    const createdCharacterIds: string[] = []
    const createdLocationIds: string[] = []
    const createdItemIds: string[] = []
    const createdStoryBeatIds: string[] = []
    let currentLocationIdBefore: string | null = null
    let timeTrackerBefore: TimeTracker | null = null

    if (trackingEnabled) {
      // Snapshot current location
      const currentLoc = this.story.location.locations.find((l) => l.current)
      currentLocationIdBefore = currentLoc?.id ?? null

      // Snapshot time tracker
      timeTrackerBefore = this.story.time.timeTracker
        ? { ...this.story.time.timeTracker }
        : null

      // Snapshot characters that will be updated
      for (const update of result.entryUpdates.characterUpdates) {
        const existing = this.story.character.characters.find(
          (c) => c.name.toLowerCase() === update.name.toLowerCase(),
        )
        if (existing) {
          charactersBefore.push({
            id: existing.id,
            name: existing.name,
            status: existing.status,
            relationship: existing.relationship,
            traits: [...existing.traits],
            visualDescriptors: { ...existing.visualDescriptors },
            metadata: existing.metadata ? { ...existing.metadata } : null,
          })
        }
      }

      // Snapshot locations that will be updated
      for (const update of result.entryUpdates.locationUpdates) {
        const existing = this.story.location.locations.find(
          (l) => l.name.toLowerCase() === update.name.toLowerCase(),
        )
        if (existing) {
          locationsBefore.push({
            id: existing.id,
            name: existing.name,
            visited: existing.visited,
            current: existing.current,
            description: existing.description,
            metadata: existing.metadata ? { ...existing.metadata } : null,
          })
        }
      }

      // Snapshot items that will be updated
      for (const update of result.entryUpdates.itemUpdates) {
        const existing = this.story.item.items.find(
          (i) => i.name.toLowerCase() === update.name.toLowerCase(),
        )
        if (existing) {
          itemsBefore.push({
            id: existing.id,
            name: existing.name,
            quantity: existing.quantity,
            equipped: existing.equipped,
            location: existing.location,
            metadata: existing.metadata ? { ...existing.metadata } : null,
          })
        }
      }

      // Snapshot story beats that will be updated
      for (const update of result.entryUpdates.storyBeatUpdates) {
        const existing = this.story.storyBeat.storyBeats.find(
          (b) => b.title.toLowerCase() === update.title.toLowerCase(),
        )
        if (existing) {
          storyBeatsBefore.push({
            id: existing.id,
            title: existing.title,
            status: existing.status,
            description: existing.description,
            resolvedAt: existing.resolvedAt ?? null,
            metadata: existing.metadata ? { ...existing.metadata } : null,
          })
        }
      }

      // Also snapshot locations that might be affected by currentLocationName scene change
      if (result.scene.currentLocationName) {
        const locationName = result.scene.currentLocationName.toLowerCase()
        const loc = this.story.location.locations.find((l) => l.name.toLowerCase() === locationName)
        if (loc && !locationsBefore.some((lb) => lb.id === loc.id)) {
          locationsBefore.push({
            id: loc.id,
            name: loc.name,
            visited: loc.visited,
            current: loc.current,
            description: loc.description,
            metadata: loc.metadata ? { ...loc.metadata } : null,
          })
        }
      }
    }

    // Apply character updates
    for (const update of result.entryUpdates.characterUpdates) {
      await this.wrapUpdate('Update character', update.name, async () => {
        let existing = this.story.character.characters.find(
          (c) => c.name.toLowerCase() === update.name.toLowerCase(),
        )

        // If character doesn't exist yet, create it first
        if (!existing) {
          const newCharData = result.entryUpdates.newCharacters.find(
            (nc) => nc.name.toLowerCase() === update.name.toLowerCase(),
          )
          log('Creating character from update (not found):', update.name)
          const charMetadata: Record<string, unknown> = { source: 'classifier' }
          if (newCharData) {
            const newCharInlineVars = extractInlineCustomVars(
              newCharData as unknown as Record<string, unknown>,
              defsByName,
            )
            if (Object.keys(newCharInlineVars).length > 0) {
              Object.assign(charMetadata, mergeRuntimeVars(null, newCharInlineVars, defsByName))
            }
          }
          const character: Character = {
            id: crypto.randomUUID(),
            storyId,
            name: newCharData?.name ?? update.name,
            description: newCharData?.description ?? null,
            relationship: newCharData?.relationship ?? null,
            traits: newCharData?.traits ?? [],
            visualDescriptors: newCharData?.visualDescriptors ?? {},
            status: (newCharData?.status as Character['status']) ?? 'active',
            metadata: charMetadata,
            portrait: null,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addCharacter(character)
          this.story.character.characters = [...this.story.character.characters, character]
          if (trackingEnabled) createdCharacterIds.push(character.id)
          existing = character
        }

        if (existing) {
          log('Updating character:', update.name, update.changes)
          const changes: Partial<Character> = {}
          if (update.changes.status) changes.status = update.changes.status
          if (update.changes.relationship) {
            if (existing.relationship === 'self') {
              // Preserve protagonist relationship; only set via explicit swap.
            } else if (update.changes.relationship !== 'self') {
              changes.relationship = update.changes.relationship
            }
          }
          if (update.changes.newTraits?.length || update.changes.removeTraits?.length) {
            let traits = [...existing.traits]
            if (update.changes.removeTraits?.length) {
              const toRemove = new Set(update.changes.removeTraits.map((t) => t.toLowerCase()))
              traits = traits.filter((t) => !toRemove.has(t.toLowerCase()))
            }
            if (update.changes.newTraits?.length) {
              traits = [...traits, ...update.changes.newTraits]
            }
            const traitMap = new Map(traits.map((t) => [t.toLowerCase(), t]))
            changes.traits = Array.from(traitMap.values())
          }
          // Handle visual descriptor updates for image generation
          // New format: visualDescriptors is a structured object that replaces entirely
          if (
            update.changes.visualDescriptors &&
            Object.keys(update.changes.visualDescriptors).length > 0
          ) {
            changes.visualDescriptors = update.changes.visualDescriptors
          }
          // Merge inline runtime variable values into metadata if present
          const charInlineVars = extractInlineCustomVars(
            update.changes as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(charInlineVars).length > 0) {
            changes.metadata = mergeRuntimeVars(existing.metadata, charInlineVars, defsByName)
          }
          // COW: ensure entity is owned by current branch before updating
          const { entity: ownedChar, wasCowed: charWasCowed } =
            await this.story.character.cowCharacter(existing)
          await database.updateCharacter(ownedChar.id, changes)
          this.story.character.characters = this.story.character.characters.map((c) =>
            c.id === ownedChar.id ? { ...c, ...changes } : c,
          )
          // If COW'd, track override as created (rollback = delete override)
          if (charWasCowed && trackingEnabled) {
            createdCharacterIds.push(ownedChar.id)
            const idx = charactersBefore.findIndex((cb) => cb.id === existing.id)
            if (idx !== -1) charactersBefore.splice(idx, 1)
          }
        }
      })
    }

    // Apply location updates
    for (const update of result.entryUpdates.locationUpdates) {
      await this.wrapUpdate('Update location', update.name, async () => {
        let existing = this.story.location.locations.find(
          (l) => l.name.toLowerCase() === update.name.toLowerCase(),
        )

        // If location doesn't exist yet, create it first
        if (!existing) {
          // Check if newLocations has data for this name
          const newLocData = result.entryUpdates.newLocations.find(
            (nl) => nl.name.toLowerCase() === update.name.toLowerCase(),
          )
          log('Creating location from update (not found):', update.name)
          const locMetadata: Record<string, unknown> = { source: 'classifier' }
          if (newLocData) {
            const newLocInlineVars = extractInlineCustomVars(
              newLocData as unknown as Record<string, unknown>,
              defsByName,
            )
            if (Object.keys(newLocInlineVars).length > 0) {
              Object.assign(locMetadata, mergeRuntimeVars(null, newLocInlineVars, defsByName))
            }
          }
          const location: Location = {
            id: crypto.randomUUID(),
            storyId,
            name: newLocData?.name ?? update.name,
            description: newLocData?.description ?? null,
            visited: newLocData?.visited ?? false,
            current: newLocData?.current ?? false,
            connections: [],
            metadata: locMetadata,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addLocation(location)
          this.story.location.locations = [...this.story.location.locations, location]
          if (trackingEnabled) createdLocationIds.push(location.id)
          existing = location
        }

        if (existing) {
          log('Updating location:', update.name, update.changes)
          const changes: Partial<Location> = {}
          if (update.changes.visited !== undefined) changes.visited = update.changes.visited
          if (update.changes.description) {
            changes.description = update.changes.description
          }
          if (update.changes.descriptionAddition) {
            const addition = update.changes.descriptionAddition.trim()
            if (addition) {
              changes.description =
                (changes.description ?? existing.description)
                  ? `${changes.description ?? existing.description} ${addition}`
                  : addition
            }
          }
          // Merge inline runtime variable values into metadata if present
          const locInlineVars = extractInlineCustomVars(
            update.changes as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(locInlineVars).length > 0) {
            changes.metadata = mergeRuntimeVars(existing.metadata, locInlineVars, defsByName)
          }

          // COW: ensure entity is owned by current branch before updating
          const { entity: ownedLoc, wasCowed: locWasCowed } =
            await this.story.location.cowLocation(existing)

          if (update.changes.current === true) {
            changes.visited = true
            if (this.story.branch.isCowBranch()) {
              // COW-aware: targeted updates instead of blanket clear
              const prevCurrent = this.story.location.locations.find(
                (l) => l.current && l.id !== ownedLoc.id,
              )
              if (prevCurrent) {
                const { entity: ownedPrev, wasCowed: prevWasCowed } =
                  await this.story.location.cowLocation(prevCurrent)
                await database.updateLocation(ownedPrev.id, { current: false })
                this.story.location.locations = this.story.location.locations.map((l) =>
                  l.id === ownedPrev.id ? { ...l, current: false } : l,
                )
                if (prevWasCowed && trackingEnabled) {
                  createdLocationIds.push(ownedPrev.id)
                  const prevIdx = locationsBefore.findIndex((lb) => lb.id === prevCurrent.id)
                  if (prevIdx !== -1) locationsBefore.splice(prevIdx, 1)
                }
              }
              await database.updateLocation(ownedLoc.id, { ...changes, current: true })
              this.story.location.locations = this.story.location.locations.map((l) =>
                l.id === ownedLoc.id ? { ...l, ...changes, current: true, visited: true } : l,
              )
            } else {
              await database.setCurrentLocation(storyId, ownedLoc.id)
              if (Object.keys(changes).length > 0) {
                await database.updateLocation(ownedLoc.id, changes)
              }
              this.story.location.locations = this.story.location.locations.map((l) => {
                if (l.id === ownedLoc.id) {
                  return { ...l, ...changes, current: true, visited: true }
                }
                return { ...l, current: false }
              })
            }
            if (locWasCowed && trackingEnabled) {
              createdLocationIds.push(ownedLoc.id)
              const idx = locationsBefore.findIndex((lb) => lb.id === existing.id)
              if (idx !== -1) locationsBefore.splice(idx, 1)
            }
            return
          }

          if (update.changes.current === false) changes.current = false
          if (Object.keys(changes).length === 0) {
            // Even if no changes, track COW if it happened
            if (locWasCowed && trackingEnabled) {
              createdLocationIds.push(ownedLoc.id)
              const idx = locationsBefore.findIndex((lb) => lb.id === existing.id)
              if (idx !== -1) locationsBefore.splice(idx, 1)
            }
            return
          }
          await database.updateLocation(ownedLoc.id, changes)
          this.story.location.locations = this.story.location.locations.map((l) =>
            l.id === ownedLoc.id ? { ...l, ...changes } : l,
          )
          if (locWasCowed && trackingEnabled) {
            createdLocationIds.push(ownedLoc.id)
            const idx = locationsBefore.findIndex((lb) => lb.id === existing.id)
            if (idx !== -1) locationsBefore.splice(idx, 1)
          }
        }
      })
    }

    // Apply item updates
    for (const update of result.entryUpdates.itemUpdates) {
      await this.wrapUpdate('Update item', update.name, async () => {
        let existing = this.story.item.items.find(
          (i) => i.name.toLowerCase() === update.name.toLowerCase(),
        )

        // If item doesn't exist yet, create it first
        if (!existing) {
          const newItemData = result.entryUpdates.newItems.find(
            (ni) => ni.name.toLowerCase() === update.name.toLowerCase(),
          )
          log('Creating item from update (not found):', update.name)
          const itemMetadata: Record<string, unknown> = { source: 'classifier' }
          if (newItemData) {
            const newItemInlineVars = extractInlineCustomVars(
              newItemData as unknown as Record<string, unknown>,
              defsByName,
            )
            if (Object.keys(newItemInlineVars).length > 0) {
              Object.assign(itemMetadata, mergeRuntimeVars(null, newItemInlineVars, defsByName))
            }
          }
          const item: Item = {
            id: crypto.randomUUID(),
            storyId,
            name: newItemData?.name ?? update.name,
            description: newItemData?.description ?? null,
            quantity: newItemData?.quantity ?? 1,
            equipped: false,
            location: newItemData?.location ?? 'inventory',
            metadata: itemMetadata,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addItem(item)
          this.story.item.items = [...this.story.item.items, item]
          if (trackingEnabled) createdItemIds.push(item.id)
          existing = item
        }

        if (existing) {
          log('Updating item:', update.name, update.changes)
          const changes: Partial<Item> = {}
          if (update.changes.quantity !== undefined) changes.quantity = update.changes.quantity
          if (update.changes.equipped !== undefined) changes.equipped = update.changes.equipped
          if (update.changes.location) changes.location = update.changes.location
          // Merge inline runtime variable values into metadata if present
          const itemInlineVars = extractInlineCustomVars(
            update.changes as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(itemInlineVars).length > 0) {
            changes.metadata = mergeRuntimeVars(existing.metadata, itemInlineVars, defsByName)
          }
          // COW: ensure entity is owned by current branch before updating
          const { entity: ownedItem, wasCowed: itemWasCowed } =
            await this.story.item.cowItem(existing)
          await database.updateItem(ownedItem.id, changes)
          this.story.item.items = this.story.item.items.map((i) =>
            i.id === ownedItem.id ? { ...i, ...changes } : i,
          )
          if (itemWasCowed && trackingEnabled) {
            createdItemIds.push(ownedItem.id)
            const idx = itemsBefore.findIndex((ib) => ib.id === existing.id)
            if (idx !== -1) itemsBefore.splice(idx, 1)
          }
        }
      })
    }

    // Apply story beat updates (mark as completed/failed)
    for (const update of result.entryUpdates.storyBeatUpdates) {
      await this.wrapUpdate('Update story beat', update.title, async () => {
        let existing = this.story.storyBeat.storyBeats.find(
          (b) => b.title.toLowerCase() === update.title.toLowerCase(),
        )

        // If story beat doesn't exist yet, create it first
        if (!existing) {
          const newBeatData = result.entryUpdates.newStoryBeats.find(
            (nb) => nb.title.toLowerCase() === update.title.toLowerCase(),
          )
          log('Creating story beat from update (not found):', update.title)
          const beatMetadata: Record<string, unknown> = { source: 'classifier' }
          if (newBeatData) {
            const newBeatInlineVars = extractInlineCustomVars(
              newBeatData as unknown as Record<string, unknown>,
              defsByName,
            )
            if (Object.keys(newBeatInlineVars).length > 0) {
              Object.assign(beatMetadata, mergeRuntimeVars(null, newBeatInlineVars, defsByName))
            }
          }
          const beat: StoryBeat = {
            id: crypto.randomUUID(),
            storyId,
            title: newBeatData?.title ?? update.title,
            description: newBeatData?.description ?? null,
            type: newBeatData?.type ?? 'event',
            status: newBeatData?.status ?? 'active',
            triggeredAt: Date.now(),
            metadata: beatMetadata,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addStoryBeat(beat)
          this.story.storyBeat.storyBeats = [...this.story.storyBeat.storyBeats, beat]
          if (trackingEnabled) createdStoryBeatIds.push(beat.id)
          existing = beat
        }

        if (existing) {
          log('Updating story beat:', update.title, update.changes)
          const changes: Partial<StoryBeat> = {}
          if (update.changes.status) {
            changes.status = update.changes.status
            // Set resolvedAt timestamp when completing or failing
            if (update.changes.status === 'completed' || update.changes.status === 'failed') {
              changes.resolvedAt = Date.now()
            }
          }
          if (update.changes.description) changes.description = update.changes.description
          // Merge inline runtime variable values into metadata if present
          const beatInlineVars = extractInlineCustomVars(
            update.changes as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(beatInlineVars).length > 0) {
            changes.metadata = mergeRuntimeVars(existing.metadata, beatInlineVars, defsByName)
          }
          // COW: ensure entity is owned by current branch before updating
          const { entity: ownedBeat, wasCowed: beatWasCowed } =
            await this.story.storyBeat.cowStoryBeat(existing)
          await database.updateStoryBeat(ownedBeat.id, changes)
          this.story.storyBeat.storyBeats = this.story.storyBeat.storyBeats.map((b) =>
            b.id === ownedBeat.id ? { ...b, ...changes } : b,
          )
          if (beatWasCowed && trackingEnabled) {
            createdStoryBeatIds.push(ownedBeat.id)
            const idx = storyBeatsBefore.findIndex((sb) => sb.id === existing.id)
            if (idx !== -1) storyBeatsBefore.splice(idx, 1)
          }
        }
      })
    }

    // Add new characters (check for duplicates)
    for (const newChar of result.entryUpdates.newCharacters) {
      await this.wrapUpdate('Add character', newChar.name, async () => {
        const exists = this.story.character.characters.some(
          (c) => c.name.toLowerCase() === newChar.name.toLowerCase(),
        )
        if (!exists) {
          log('Adding new character:', newChar.name)
          const charMetadata: Record<string, unknown> = { source: 'classifier' }
          const newCharInlineVars = extractInlineCustomVars(
            newChar as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(newCharInlineVars).length > 0) {
            Object.assign(charMetadata, mergeRuntimeVars(null, newCharInlineVars, defsByName))
          }
          const character: Character = {
            id: crypto.randomUUID(),
            storyId,
            name: newChar.name,
            description: newChar.description ?? null,
            relationship: newChar.relationship ?? null,
            traits: newChar.traits ?? [],
            visualDescriptors: newChar.visualDescriptors ?? {},
            status: 'active',
            metadata: charMetadata,
            portrait: null,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addCharacter(character)
          this.story.character.characters = [...this.story.character.characters, character]
          if (trackingEnabled) createdCharacterIds.push(character.id)
        }
      })
    }

    // Handle scene.currentLocationName - update current location if specified
    // Runs before newLocations so stubs are available for merging
    if (result.scene.currentLocationName) {
      await this.wrapUpdate('Set scene location', result.scene.currentLocationName, async () => {
        const locationName = result.scene.currentLocationName!.toLowerCase()
        let currentLoc = this.story.location.locations.find(
          (l) => l.name.toLowerCase() === locationName,
        )

        // If location doesn't exist yet, create a stub
        if (!currentLoc) {
          log(
            'Creating stub location from scene.currentLocationName:',
            result.scene.currentLocationName,
          )
          const stubLocation: Location = {
            id: crypto.randomUUID(),
            storyId,
            name: result.scene.currentLocationName!,
            description: null,
            visited: true,
            current: false,
            connections: [],
            metadata: { source: 'classifier' },
            branchId: this.story.branch.currentBranchId,
          }
          await database.addLocation(stubLocation)
          this.story.location.locations = [...this.story.location.locations, stubLocation]
          if (trackingEnabled) createdLocationIds.push(stubLocation.id)
          currentLoc = stubLocation
        }

        if (currentLoc && !currentLoc.current) {
          log('Setting current location from scene:', currentLoc.name)
          if (this.story.branch.isCowBranch()) {
            // COW-aware: targeted updates
            const { entity: ownedTarget, wasCowed: targetWasCowed } =
              await this.story.location.cowLocation(currentLoc)
            const prevCurrent = this.story.location.locations.find(
              (l) => l.current && l.id !== ownedTarget.id,
            )
            if (prevCurrent) {
              const { entity: ownedPrev, wasCowed: prevWasCowed } =
                await this.story.location.cowLocation(prevCurrent)
              await database.updateLocation(ownedPrev.id, { current: false })
              this.story.location.locations = this.story.location.locations.map((l) =>
                l.id === ownedPrev.id ? { ...l, current: false } : l,
              )
              if (prevWasCowed && trackingEnabled) {
                createdLocationIds.push(ownedPrev.id)
                const idx = locationsBefore.findIndex((lb) => lb.id === prevCurrent.id)
                if (idx !== -1) locationsBefore.splice(idx, 1)
              }
            }
            await database.updateLocation(ownedTarget.id, { current: true, visited: true })
            this.story.location.locations = this.story.location.locations.map((l) =>
              l.id === ownedTarget.id ? { ...l, current: true, visited: true } : l,
            )
            if (targetWasCowed && trackingEnabled) {
              createdLocationIds.push(ownedTarget.id)
              const idx = locationsBefore.findIndex((lb) => lb.id === currentLoc!.id)
              if (idx !== -1) locationsBefore.splice(idx, 1)
            }
          } else {
            await database.setCurrentLocation(storyId, currentLoc.id)
            this.story.location.locations = this.story.location.locations.map((l) => ({
              ...l,
              current: l.id === currentLoc!.id,
              visited: l.id === currentLoc!.id ? true : l.visited,
            }))
          }
        }
      })
    }

    // Add new locations (check for duplicates, merge into recently created)
    for (const newLoc of result.entryUpdates.newLocations) {
      await this.wrapUpdate('Add location', newLoc.name, async () => {
        const existing = this.story.location.locations.find(
          (l) => l.name.toLowerCase() === newLoc.name.toLowerCase(),
        )
        if (existing && createdLocationIds.includes(existing.id)) {
          // Merge into location created earlier in this classification run
          // (e.g. stub from scene.currentLocationName or from update handler)
          log('Merging new location into recently created:', newLoc.name)
          const changes: Partial<Location> = {}
          if (newLoc.description && !existing.description) {
            changes.description = newLoc.description
          }
          if (newLoc.visited !== undefined && newLoc.visited !== existing.visited) {
            changes.visited = newLoc.visited
          }
          if (newLoc.current && !existing.current) {
            changes.current = true
            changes.visited = true
          }
          // Merge inline runtime variable values into metadata if present
          const newLocInlineVars = extractInlineCustomVars(
            newLoc as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(newLocInlineVars).length > 0) {
            changes.metadata = mergeRuntimeVars(existing.metadata, newLocInlineVars, defsByName)
          }
          if (Object.keys(changes).length > 0) {
            await database.updateLocation(existing.id, changes)
            this.story.location.locations = this.story.location.locations.map((l) =>
              l.id === existing.id ? { ...l, ...changes } : l,
            )
          }
        } else if (!existing) {
          log('Adding new location:', newLoc.name)
          // If this is the current location, unset others first
          if (newLoc.current) {
            if (this.story.branch.isCowBranch()) {
              // COW-aware: targeted unset of previous current
              const prevCurrent = this.story.location.locations.find((l) => l.current)
              if (prevCurrent) {
                const { entity: ownedPrev } = await this.story.location.cowLocation(prevCurrent)
                await database.updateLocation(ownedPrev.id, { current: false })
                this.story.location.locations = this.story.location.locations.map((l) =>
                  l.id === ownedPrev.id ? { ...l, current: false } : l,
                )
              }
            } else {
              this.story.location.locations = this.story.location.locations.map((l) => ({
                ...l,
                current: false,
              }))
              for (const l of this.story.location.locations) {
                await database.updateLocation(l.id, { current: false })
              }
            }
          }
          const locMetadata: Record<string, unknown> = { source: 'classifier' }
          const newLocInlineVars = extractInlineCustomVars(
            newLoc as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(newLocInlineVars).length > 0) {
            Object.assign(locMetadata, mergeRuntimeVars(null, newLocInlineVars, defsByName))
          }
          const location: Location = {
            id: crypto.randomUUID(),
            storyId,
            name: newLoc.name,
            description: newLoc.description ?? null,
            visited: newLoc.visited ?? false,
            current: newLoc.current ?? false,
            connections: [],
            metadata: locMetadata,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addLocation(location)
          this.story.location.locations = [...this.story.location.locations, location]
          if (trackingEnabled) createdLocationIds.push(location.id)
        }
      })
    }

    // Add new items (check for duplicates)
    for (const newItem of result.entryUpdates.newItems) {
      await this.wrapUpdate('Add item', newItem.name, async () => {
        const exists = this.story.item.items.some(
          (i) => i.name.toLowerCase() === newItem.name.toLowerCase(),
        )
        if (!exists) {
          log('Adding new item:', newItem.name)
          const itemMetadata: Record<string, unknown> = { source: 'classifier' }
          const newItemInlineVars = extractInlineCustomVars(
            newItem as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(newItemInlineVars).length > 0) {
            Object.assign(itemMetadata, mergeRuntimeVars(null, newItemInlineVars, defsByName))
          }
          const item: Item = {
            id: crypto.randomUUID(),
            storyId,
            name: newItem.name,
            description: newItem.description ?? null,
            quantity: newItem.quantity ?? 1,
            equipped: false,
            location: newItem.location ?? 'inventory',
            metadata: itemMetadata,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addItem(item)
          this.story.item.items = [...this.story.item.items, item]
          if (trackingEnabled) createdItemIds.push(item.id)
        }
      })
    }

    // Add new story beats (check for duplicates)
    for (const newBeat of result.entryUpdates.newStoryBeats) {
      await this.wrapUpdate('Add story beat', newBeat.title, async () => {
        const exists = this.story.storyBeat.storyBeats.some(
          (b) => b.title.toLowerCase() === newBeat.title.toLowerCase(),
        )
        if (!exists) {
          log('Adding new story beat:', newBeat.title)
          const beatMetadata: Record<string, unknown> = { source: 'classifier' }
          const newBeatInlineVars = extractInlineCustomVars(
            newBeat as unknown as Record<string, unknown>,
            defsByName,
          )
          if (Object.keys(newBeatInlineVars).length > 0) {
            Object.assign(beatMetadata, mergeRuntimeVars(null, newBeatInlineVars, defsByName))
          }
          const beat: StoryBeat = {
            id: crypto.randomUUID(),
            storyId,
            title: newBeat.title,
            description: newBeat.description ?? null,
            type: newBeat.type ?? 'event',
            status: newBeat.status ?? 'active',
            triggeredAt: Date.now(),
            metadata: beatMetadata,
            branchId: this.story.branch.currentBranchId,
          }
          await database.addStoryBeat(beat)
          this.story.storyBeat.storyBeats = [...this.story.storyBeat.storyBeats, beat]
          if (trackingEnabled) createdStoryBeatIds.push(beat.id)
        }
      })
    }

    // Apply time progression from scene data
    if (result.scene.timeProgression && result.scene.timeProgression !== 'none') {
      await this.story.time.applyTimeProgression(result.scene.timeProgression)
    }

    // Phase 1: Save world state delta on the entry
    if (trackingEnabled && entryId) {
      try {
        const delta: WorldStateDelta = {
          classificationResult: result as unknown as Record<string, unknown>,
          previousState: {
            characters: charactersBefore,
            locations: locationsBefore,
            items: itemsBefore,
            storyBeats: storyBeatsBefore,
            currentLocationId: currentLocationIdBefore,
            timeTracker: timeTrackerBefore,
          },
          createdEntities: {
            characterIds: createdCharacterIds,
            locationIds: createdLocationIds,
            itemIds: createdItemIds,
            storyBeatIds: createdStoryBeatIds,
          },
        }

        await database.updateStoryEntry(entryId, { worldStateDelta: delta })
        // Update in-memory entry
        this.story.entry.entries = this.story.entry.entries.map((e) =>
          e.id === entryId ? { ...e, worldStateDelta: delta } : e,
        )

        log('World state delta saved for entry', {
          entryId,
          updatedCharacters: charactersBefore.length,
          updatedLocations: locationsBefore.length,
          updatedItems: itemsBefore.length,
          updatedStoryBeats: storyBeatsBefore.length,
          createdCharacters: createdCharacterIds.length,
          createdLocations: createdLocationIds.length,
          createdItems: createdItemIds.length,
          createdStoryBeats: createdStoryBeatIds.length,
        })

        // Auto-snapshot if interval reached
        await this.story.maybeCreateAutoSnapshot(entryId)
      } catch (error) {
        console.error('[StoryStore] Failed to save world state delta:', error)
        // Non-fatal - don't break the main flow
      }
    }

    log('applyClassificationResult complete', {
      characters: this.story.character.characters.length,
      locations: this.story.location.locations.length,
      items: this.story.item.items.length,
      storyBeats: this.story.storyBeat.storyBeats.length,
    })

    // Sync all entity arrays to singleton after classification mutations

    // Emit state updated event if there were any changes
    const hasChanges =
      result.entryUpdates.newCharacters.length > 0 ||
      result.entryUpdates.newLocations.length > 0 ||
      result.entryUpdates.newItems.length > 0 ||
      result.entryUpdates.newStoryBeats.length > 0 ||
      result.entryUpdates.characterUpdates.length > 0 ||
      result.entryUpdates.locationUpdates.length > 0 ||
      result.entryUpdates.itemUpdates.length > 0 ||
      result.entryUpdates.storyBeatUpdates.length > 0

    if (hasChanges) {
      emitStateUpdated({
        characters:
          result.entryUpdates.newCharacters.length + result.entryUpdates.characterUpdates.length,
        locations:
          result.entryUpdates.newLocations.length + result.entryUpdates.locationUpdates.length,
        items: result.entryUpdates.newItems.length + result.entryUpdates.itemUpdates.length,
        storyBeats:
          result.entryUpdates.newStoryBeats.length + result.entryUpdates.storyBeatUpdates.length,
      })
    }
  }
}
