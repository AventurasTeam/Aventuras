import type { StoryStore } from './types'
import type { Location } from '$lib/types'
import { database } from '$lib/services/database'
import { settings } from '../settings.svelte'

const DEBUG = true
function log(...args: any[]) {
  if (DEBUG) {
    console.log('[StoryContext-Location]', ...args)
  }
}

export class StoryLocationStore {
  constructor(private story: StoryStore) {}
  locations = $state<Location[]>([])

  get currentLocation(): Location | undefined {
    return this.locations.find((l) => l.current)
  }

  // Add a location
  async addLocation(name: string, description?: string, makeCurrent = false): Promise<Location> {
    if (!this.story.id) throw new Error('No story loaded')

    const location: Location = {
      id: crypto.randomUUID(),
      storyId: this.story.id!,
      name,
      description: description ?? null,
      visited: makeCurrent,
      current: makeCurrent,
      connections: [],
      metadata: null,
      branchId: this.story.branch.currentBranchId,
    }

    await database.addLocation(location)

    if (makeCurrent) {
      // Update other locations to not be current
      this.locations = this.locations.map((l) => ({ ...l, current: false }))
    }

    this.locations = [...this.locations, location]
    return location
  }

  // Update a location's details
  async updateLocation(id: string, updates: Partial<Location>): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const existing = this.locations.find((l) => l.id === id)
    if (!existing) throw new Error('Location not found')

    // COW: ensure entity is owned by current branch before updating
    const { entity: owned } = await this.cowLocation(existing)

    if (updates.current === true) {
      if (this.story.branch.isCowBranch()) {
        // COW-aware: targeted updates instead of blanket clear
        const prevCurrent = this.locations.find((l) => l.current && l.id !== owned.id)
        if (prevCurrent) {
          const { entity: ownedPrev } = await this.cowLocation(prevCurrent)
          await database.updateLocation(ownedPrev.id, { current: false })
          this.locations = this.locations.map((l) =>
            l.id === ownedPrev.id ? { ...l, current: false } : l,
          )
        }
        await database.updateLocation(owned.id, { ...updates, visited: true })
        this.locations = this.locations.map((l) =>
          l.id === owned.id ? { ...l, ...updates, current: true, visited: true } : l,
        )
      } else {
        await database.setCurrentLocation(this.story.id!, owned.id)
        this.locations = this.locations.map((l) => ({
          ...l,
          current: l.id === owned.id,
          visited: l.id === owned.id ? true : l.visited,
        }))
      }
    } else {
      await database.updateLocation(owned.id, updates)
      this.locations = this.locations.map((l) => (l.id === owned.id ? { ...l, ...updates } : l))
    }
  }

  // Set current location
  async setCurrentLocation(locationId: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    if (this.story.branch.isCowBranch()) {
      // COW-aware: targeted updates instead of blanket clear
      const target = this.locations.find((l) => l.id === locationId)
      const prevCurrent = this.locations.find((l) => l.current && l.id !== locationId)

      if (target) {
        const { entity: ownedTarget } = await this.cowLocation(target)
        await database.updateLocation(ownedTarget.id, { current: true, visited: true })
        this.locations = this.locations.map((l) =>
          l.id === ownedTarget.id ? { ...l, current: true, visited: true } : l,
        )
      }
      if (prevCurrent) {
        const { entity: ownedPrev } = await this.cowLocation(prevCurrent)
        await database.updateLocation(ownedPrev.id, { current: false })
        this.locations = this.locations.map((l) =>
          l.id === ownedPrev.id ? { ...l, current: false } : l,
        )
      }
    } else {
      await database.setCurrentLocation(this.story.id!, locationId)
      this.locations = this.locations.map((l) => ({
        ...l,
        current: l.id === locationId,
        visited: l.id === locationId ? true : l.visited,
      }))
    }
  }

  // Toggle location visited status
  async toggleLocationVisited(locationId: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const location = this.locations.find((l) => l.id === locationId)
    if (!location) throw new Error('Location not found')

    const newVisited = !location.visited
    await database.updateLocation(locationId, { visited: newVisited })
    this.locations = this.locations.map((l) =>
      l.id === locationId ? { ...l, visited: newVisited } : l,
    )
    log('Location visited toggled:', location.name, newVisited)
  }

  // Delete a location
  async deleteLocation(locationId: string): Promise<void> {
    if (!this.story.id) throw new Error('No story loaded')

    const location = this.locations.find((l) => l.id === locationId)
    if (!location) throw new Error('Location not found')

    if (settings.experimentalFeatures.lightweightBranches) {
      if (location.branchId === this.story.branch.currentBranchId) {
        await database.markLocationDeleted(locationId)
      } else {
        const { entity: owned } = await this.cowLocation(location)
        await database.markLocationDeleted(owned.id)
      }
    } else {
      await database.deleteLocation(locationId)
    }
    this.locations = this.locations.filter((l) => l.id !== locationId)
    log('Location deleted:', location.name)
  }

  /**
   * Ensure a location is owned by the current branch (COW).
   */
  async cowLocation(entity: Location): Promise<{ entity: Location; wasCowed: boolean }> {
    const branchId = this.story.branch.currentBranchId
    if (
      !branchId ||
      entity.branchId === branchId ||
      !settings.experimentalFeatures.lightweightBranches
    ) {
      return { entity, wasCowed: false }
    }

    const override: Location = {
      ...entity,
      id: crypto.randomUUID(),
      branchId,
      overridesId: entity.overridesId ?? entity.id,
    }
    await database.addLocation(override)
    this.locations = this.locations.map((l) => (l.id === entity.id ? override : l))
    log(
      'COW: Created location override',
      override.name,
      override.id,
      '→ overrides',
      override.overridesId,
    )
    return { entity: override, wasCowed: true }
  }
}
