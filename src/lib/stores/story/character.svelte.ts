import { database } from '$lib/services/database'
import type { Character, PersistentCharacterSnapshot } from '$lib/types'
import { settings } from '../settings.svelte'
import type { StoryStore } from './index.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Character]', ...args)
  }
}

export class StoryCharacterStore {
  constructor(private story: StoryStore) {}
  characters = $state<Character[]>([])

  get protagonist(): Character | undefined {
    return this.characters.find((c) => c.relationship === 'self')
  }

  get activeCharacters(): Character[] {
    return this.characters.filter((c) => c.status === 'active')
  }

  // Add a character
  async addCharacter(
    name: string,
    description?: string,
    relationship?: string,
  ): Promise<Character> {
    if (!this.story.id) throw new Error('No story loaded')

    const character: Character = {
      id: crypto.randomUUID(),
      storyId: this.story.id,
      name,
      description: description ?? null,
      relationship: relationship ?? null,
      traits: [],
      status: 'active',
      metadata: null,
      visualDescriptors: {},
      portrait: null,
      branchId: this.story.branch.currentBranchId,
    }

    await database.addCharacter(character)
    this.characters = [...this.characters, character]
    return character
  }

  // Update an existing character (except protagonist swap)
  async updateCharacter(id: string, updates: Partial<Character>): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.characters.find((c) => c.id === id)
    if (!existing) throw new Error('Character not found')

    if (updates.relationship !== undefined) {
      if (updates.relationship === 'self' && existing.relationship !== 'self') {
        throw new Error('Use setProtagonist to assign a protagonist')
      }
      if (existing.relationship === 'self' && updates.relationship !== 'self') {
        throw new Error('Swap protagonists before changing the current one')
      }
    }

    // COW: ensure entity is owned by current branch before updating
    const { entity: owned } = await this.cowCharacter(existing)
    await database.updateCharacter(owned.id, updates)
    this.characters = this.characters.map((c) => (c.id === owned.id ? { ...c, ...updates } : c))
  }

  // Delete a character (protagonist cannot be deleted)
  async deleteCharacter(id: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.characters.find((c) => c.id === id)
    if (!existing) throw new Error('Character not found')
    if (existing.relationship === 'self') {
      throw new Error('Swap protagonists before deleting the current one')
    }

    if (settings.experimentalFeatures.lightweightBranches) {
      // COD: tombstone instead of hard-deleting to preserve row for sibling/child branches
      if (existing.branchId === this.story.branch.currentBranchId) {
        // Entity is owned by current branch (or main) — mark deleted in place
        await database.markCharacterDeleted(id)
      } else {
        // Entity is inherited from another branch — create tombstone override
        const { entity: owned } = await this.cowCharacter(existing)
        await database.markCharacterDeleted(owned.id)
      }
    } else {
      await database.deleteCharacter(id)
    }
    this.characters = this.characters.filter((c) => c.id !== id)
  }

  // Swap the protagonist to another character, updating the old label
  async setProtagonist(newCharacterId: string, previousRelationshipLabel?: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const currentProtagonist = this.characters.find((c) => c.relationship === 'self') ?? null
    const newProtagonist = this.characters.find((c) => c.id === newCharacterId)
    if (!newProtagonist) throw new Error('Character not found')

    if (currentProtagonist?.id === newCharacterId) return

    let label: string | null = null
    if (currentProtagonist) {
      label = previousRelationshipLabel?.trim() ?? null
      if (!label || label.toLowerCase() === 'self') {
        throw new Error('Provide a relationship label for the previous protagonist')
      }
      // COW: ensure old protagonist is owned by current branch
      const { entity: ownedOld } = await this.cowCharacter(currentProtagonist)
      await database.updateCharacter(ownedOld.id, { relationship: label })
    }

    // COW: ensure new protagonist is owned by current branch
    const { entity: ownedNew } = await this.cowCharacter(newProtagonist)
    await database.updateCharacter(ownedNew.id, { relationship: 'self' })

    this.characters = this.characters.map((c) => {
      if (
        currentProtagonist &&
        (c.overridesId === currentProtagonist.overridesId ||
          c.overridesId === currentProtagonist.id ||
          c.id === currentProtagonist.id)
      ) {
        // Find the current in-memory version that replaced the old protagonist
        if (c.relationship !== 'self') return c
        return { ...c, relationship: label! }
      }
      if (c.id === ownedNew.id) {
        return { ...c, relationship: 'self' }
      }
      return c
    })
  }

  /**
   * Ensure a character is owned by the current branch (COW).
   * If the character is inherited from a parent branch, creates an override.
   * Returns the owned character (either the original or the new override).
   */
  async cowCharacter(entity: Character): Promise<{ entity: Character; wasCowed: boolean }> {
    const branchId = this.story.branch.currentBranchId
    if (
      !branchId ||
      entity.branchId === branchId ||
      !settings.experimentalFeatures.lightweightBranches
    ) {
      return { entity, wasCowed: false }
    }

    const override: Character = {
      ...entity,
      id: crypto.randomUUID(),
      branchId,
      overridesId: entity.overridesId ?? entity.id,
    }
    await database.addCharacter(override)
    this.characters = this.characters.map((c) => (c.id === entity.id ? override : c))
    log(
      'COW: Created character override',
      override.name,
      override.id,
      '→ overrides',
      override.overridesId,
    )
    return { entity: override, wasCowed: true }
  }

  /**
   * Restore character state fields from persistent retry snapshots.
   * Used for retry restores that don't have full state snapshots.
   */
  async restoreCharacterSnapshots(snapshots?: PersistentCharacterSnapshot[]): Promise<void> {
    log('restoreCharacterSnapshots called', {
      hasCurrentStory: !!this.story.isLoaded,
      snapshotsCount: snapshots?.length ?? 0,
      snapshots: snapshots?.map((s) => ({ id: s.id, visualDescriptors: s.visualDescriptors })),
      currentCharacters: this.story.character.characters.map((c) => ({
        id: c.id,
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      })),
    })

    if (!this.story.id || !snapshots || snapshots.length === 0) {
      log('restoreCharacterSnapshots: early return - no story or no snapshots')
      return
    }

    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
    const updates: Array<{ id: string; updates: Partial<Character> }> = []

    for (const character of this.story.character.characters) {
      const snapshot = snapshotById.get(character.id)
      if (!snapshot) continue

      let relationship = snapshot.relationship ?? character.relationship
      if (character.relationship === 'self' && relationship !== 'self') {
        relationship = 'self'
      }

      updates.push({
        id: character.id,
        updates: {
          traits: snapshot.traits ?? [],
          status: snapshot.status ?? character.status,
          relationship,
          visualDescriptors: snapshot.visualDescriptors ?? {},
          portrait: snapshot.portrait,
        },
      })
    }

    for (const update of updates) {
      await database.updateCharacter(update.id, update.updates)
    }

    this.story.character.characters = this.story.character.characters.map((character) => {
      const snapshot = snapshotById.get(character.id)
      if (!snapshot) return character

      let relationship = snapshot.relationship ?? character.relationship
      if (character.relationship === 'self' && relationship !== 'self') {
        relationship = 'self'
      }

      return {
        ...character,
        traits: snapshot.traits ?? character.traits,
        status: snapshot.status ?? character.status,
        relationship,
        visualDescriptors: snapshot.visualDescriptors ?? character.visualDescriptors,
        portrait: snapshot.portrait, // Use snapshot value directly (null means no portrait)
      }
    })

    log('restoreCharacterSnapshots complete', {
      updatedCount: updates.length,
      finalCharacters: this.story.character.characters.map((c) => ({
        id: c.id,
        name: c.name,
        visualDescriptors: c.visualDescriptors,
      })),
    })
  }
}
