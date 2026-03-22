import { database } from '$lib/services/database'
import type { Item } from '$lib/types'
import { settings } from '../settings.svelte'
import type { StoryStore } from './types'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Item]', ...args)
  }
}

export class StoryItemStore {
  constructor(private story: StoryStore) {}

  items = $state<Item[]>([])

  get inventoryItems(): Item[] {
    return this.items.filter((i) => i.location === 'inventory')
  }

  get equippedItems(): Item[] {
    return this.items.filter((i) => i.equipped)
  }

  // Add an item to inventory
  async addItem(name: string, description?: string, quantity = 1): Promise<Item> {
    if (!this.story.id) throw new Error('No story loaded')

    const item: Item = {
      id: crypto.randomUUID(),
      storyId: this.story.id!,
      name,
      description: description ?? null,
      quantity,
      equipped: false,
      location: 'inventory',
      metadata: null,
      branchId: this.story.branch.currentBranchId,
    }

    await database.addItem(item)
    this.items = [...this.items, item]
    return item
  }

  // Update an existing item
  async updateItem(id: string, updates: Partial<Item>): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.items.find((i) => i.id === id)
    if (!existing) throw new Error('Item not found')

    // COW: ensure entity is owned by current branch before updating
    const { entity: owned } = await this.cowItem(existing)
    await database.updateItem(owned.id, updates)
    this.items = this.items.map((i) => (i.id === owned.id ? { ...i, ...updates } : i))
  }

  // Delete an item
  async deleteItem(id: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.items.find((i) => i.id === id)
    if (!existing) throw new Error('Item not found')

    if (settings.experimentalFeatures.lightweightBranches) {
      if (existing.branchId === this.story.branch.currentBranchId) {
        await database.markItemDeleted(id)
      } else {
        const { entity: owned } = await this.cowItem(existing)
        await database.markItemDeleted(owned.id)
      }
    } else {
      await database.deleteItem(id)
    }
    this.items = this.items.filter((i) => i.id !== id)
  }

  /**
   * Ensure an item is owned by the current branch (COW).
   */
  async cowItem(entity: Item): Promise<{ entity: Item; wasCowed: boolean }> {
    const branchId = this.story.branch.currentBranchId
    if (
      !branchId ||
      entity.branchId === branchId ||
      !settings.experimentalFeatures.lightweightBranches
    ) {
      return { entity, wasCowed: false }
    }

    const override: Item = {
      ...entity,
      id: crypto.randomUUID(),
      branchId,
      overridesId: entity.overridesId ?? entity.id,
    }
    await database.addItem(override)
    this.items = this.items.map((i) => (i.id === entity.id ? override : i))
    log(
      'COW: Created item override',
      override.name,
      override.id,
      '→ overrides',
      override.overridesId,
    )
    return { entity: override, wasCowed: true }
  }
}
