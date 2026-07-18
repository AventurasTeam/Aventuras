/**
 * Reactive in-memory store for model health pings, backed by SQLite cache.
 * Uses SvelteMap (svelte/reactivity) so consumers re-render on .set/.delete
 * without needing to reassign the entire map.
 */

import { SvelteMap } from 'svelte/reactivity'
import type { APIProfile } from '$lib/types'
import { type CachedHealth, type PingResult } from '$lib/constants/modelHealth'
import { getAllForKey } from '$lib/services/modelHealthCache'
import { getEffectiveBaseUrl } from '$lib/services/ai/sdk/providers/modelPing'

function key(providerId: string, modelId: string, baseUrl: string): string {
  return `${providerId}|${modelId}|${baseUrl}`
}

class ModelHealthStore {
  private map = new SvelteMap<string, CachedHealth>()
  private hydrationPromises = new Map<string, Promise<void>>()
  private hydratedKeys = new Set<string>()

  get(providerId: string, modelId: string, baseUrl: string): CachedHealth | undefined {
    return this.map.get(key(providerId, modelId, baseUrl))
  }

  /**
   * Synchronous lookup by profile + model.
   * Returns undefined if hydrateFromDb() hasn't completed yet for this profile.
   */
  getByProfile(profile: APIProfile, modelId: string): CachedHealth | undefined {
    const baseUrl = getEffectiveBaseUrl(profile)
    if (!baseUrl) return undefined
    return this.get(profile.providerType, modelId, baseUrl)
  }

  setMany(
    rows: Array<{
      providerId: string
      modelId: string
      baseUrl: string
      result: PingResult
      checkedAt: number
    }>,
  ): void {
    for (const r of rows) {
      this.map.set(key(r.providerId, r.modelId, r.baseUrl), {
        ...r.result,
        checkedAt: r.checkedAt,
      })
    }
  }

  async hydrateFromDb(providerId: string, baseUrl: string): Promise<void> {
    const k = `${providerId}|${baseUrl}`
    if (this.hydratedKeys.has(k)) return
    const inflight = this.hydrationPromises.get(k)
    if (inflight) return inflight

    const promise = (async () => {
      const cached = await getAllForKey(providerId, baseUrl)
      for (const [modelId, health] of cached) {
        this.map.set(key(providerId, modelId, baseUrl), health)
      }
      this.hydratedKeys.add(k)
    })()

    this.hydrationPromises.set(k, promise)
    try {
      await promise
    } finally {
      this.hydrationPromises.delete(k)
    }
  }

  /**
   * Extract (providerId, baseUrl) from a map key without assuming modelId
   * is pipe-free: providerId is the first segment, baseUrl is the last.
   */
  private parseKeyPrefix(k: string): string | null {
    const firstPipe = k.indexOf('|')
    const lastPipe = k.lastIndexOf('|')
    if (firstPipe === -1 || firstPipe === lastPipe) return null
    return `${k.slice(0, firstPipe)}|${k.slice(lastPipe + 1)}`
  }

  /**
   * Clear health data from memory for a specific provider + baseUrl.
   */
  clearForProfile(providerId: string, baseUrl: string): void {
    const target = `${providerId}|${baseUrl}`
    for (const k of [...this.map.keys()]) {
      if (this.parseKeyPrefix(k) === target) this.map.delete(k)
    }
    this.hydratedKeys.delete(target)
  }

  /**
   * Drop entries whose `${providerId}|${baseUrl}` prefix is not in activeKeys.
   * Called after profile add/remove to bound memory.
   */
  evictForeign(activeKeys: Set<string>, activeProfileIds: Set<string>): void {
    void activeProfileIds // kept for API symmetry; no per-profile memo to clean up

    for (const k of [...this.map.keys()]) {
      const prefix = this.parseKeyPrefix(k)
      if (!prefix || !activeKeys.has(prefix)) this.map.delete(k)
    }

    for (const k of this.hydratedKeys) {
      if (!activeKeys.has(k)) this.hydratedKeys.delete(k)
    }
  }
}

export const modelHealth = new ModelHealthStore()
