/**
 * Reactive in-memory store for model health pings, backed by SQLite cache.
 * Uses SvelteMap (svelte/reactivity) so consumers re-render on .set/.delete
 * without needing to reassign the entire map.
 */

import { SvelteMap } from 'svelte/reactivity'
import type { APIProfile } from '$lib/types'
import { type CachedHealth, type PingResult } from '$lib/constants/modelHealth'
import { hashApiKey } from '$lib/utils/hashApiKey'
import { getAllForKey } from '$lib/services/modelHealthCache'

function key(providerId: string, modelId: string, apiKeyHash: string): string {
  return `${providerId}|${modelId}|${apiKeyHash}`
}

class ModelHealthStore {
  private map = new SvelteMap<string, CachedHealth>()
  private hydrationPromises = new Map<string, Promise<void>>()
  private hydratedKeys = new Set<string>()
  // Memo: profileId → last computed apiKeyHash (sync access for getters)
  private profileHashCache = new Map<string, { apiKey: string; hash: string }>()

  get(providerId: string, modelId: string, apiKeyHash: string): CachedHealth | undefined {
    return this.map.get(key(providerId, modelId, apiKeyHash))
  }

  /**
   * Synchronous lookup by profile + model.
   * Returns undefined in two distinct cases:
   *   1. The API key hasn't been hashed yet — call ensureHash() + hydrateFromDb() first.
   *   2. The hash is known but no ping result exists yet for this model.
   * Callers cannot distinguish these cases; treat undefined as "not yet available".
   */
  getByProfile(profile: APIProfile, modelId: string): CachedHealth | undefined {
    const memo = this.profileHashCache.get(profile.id)
    if (!memo || memo.apiKey !== profile.apiKey) return undefined
    return this.get(profile.providerType, modelId, memo.hash)
  }

  setMany(
    rows: Array<{
      providerId: string
      modelId: string
      apiKeyHash: string
      result: PingResult
      checkedAt: number
    }>,
  ): void {
    for (const r of rows) {
      this.map.set(key(r.providerId, r.modelId, r.apiKeyHash), {
        ...r.result,
        checkedAt: r.checkedAt,
      })
    }
  }

  /**
   * Pre-compute and memoize hash for a profile. Required before getByProfile
   * can return data for that profile.
   */
  async ensureHash(profile: APIProfile): Promise<string> {
    const memo = this.profileHashCache.get(profile.id)
    if (memo && memo.apiKey === profile.apiKey) return memo.hash
    const hash = await hashApiKey(profile.apiKey)
    this.profileHashCache.set(profile.id, { apiKey: profile.apiKey, hash })
    return hash
  }

  async hydrateFromDb(providerId: string, apiKeyHash: string): Promise<void> {
    const k = `${providerId}|${apiKeyHash}`
    if (this.hydratedKeys.has(k)) return
    const inflight = this.hydrationPromises.get(k)
    if (inflight) return inflight

    const promise = (async () => {
      const cached = await getAllForKey(providerId, apiKeyHash)
      for (const [modelId, health] of cached) {
        this.map.set(key(providerId, modelId, apiKeyHash), health)
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
   * Extract (providerId, apiKeyHash) from a map key without assuming modelId
   * is pipe-free: providerId is the first segment, apiKeyHash is the last.
   */
  private parseKeyPrefix(k: string): string | null {
    const firstPipe = k.indexOf('|')
    const lastPipe = k.lastIndexOf('|')
    if (firstPipe === -1 || firstPipe === lastPipe) return null
    return `${k.slice(0, firstPipe)}|${k.slice(lastPipe + 1)}`
  }

  /**
   * Clear health data from memory for a specific profile.
   */
  clearForProfile(providerId: string, apiKeyHash: string): void {
    const target = `${providerId}|${apiKeyHash}`
    for (const k of [...this.map.keys()]) {
      if (this.parseKeyPrefix(k) === target) this.map.delete(k)
    }
    this.hydratedKeys.delete(target)
  }

  /**
   * Drop entries whose `${providerId}|${apiKeyHash}` prefix is not in
   * activeKeys, and drop hash memos for non-active profile IDs.
   * Called after profile add/remove to bound memory.
   */
  evictForeign(activeKeys: Set<string>, activeProfileIds: Set<string>): void {
    // 1. Clean up the health data map
    for (const k of [...this.map.keys()]) {
      const prefix = this.parseKeyPrefix(k)
      if (!prefix || !activeKeys.has(prefix)) this.map.delete(k)
    }

    // 2. Clean up hydration records for inactive keys
    for (const k of this.hydratedKeys) {
      if (!activeKeys.has(k)) this.hydratedKeys.delete(k)
    }

    // 3. Clean up the profile hash memos
    for (const [profileId] of this.profileHashCache) {
      if (!activeProfileIds.has(profileId)) {
        this.profileHashCache.delete(profileId)
      }
    }
  }
}

export const modelHealth = new ModelHealthStore()
