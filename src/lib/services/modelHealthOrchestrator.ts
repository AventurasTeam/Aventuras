/**
 * Orchestrates ping batches for OpenRouter (free models only) and NVIDIA NIM
 * profiles, with concurrency limiting, fresh-cache skip, and
 * single-transaction batch upsert at the end.
 * Rate-limited models (429) are stored as 'rate_limited' status and skipped on next run if still fresh.
 */

import type { APIProfile } from '$lib/types'
import { settings } from '$lib/stores/settings.svelte'
import { pingModel, getEffectiveBaseUrl } from '$lib/services/ai/sdk/providers/modelPing'
import {
  upsertBatch,
  isFresh,
  deleteModelHealthForKey,
  type UpsertRow,
} from '$lib/services/modelHealthCache'
import { modelHealth } from '$lib/stores/modelHealth.svelte'
import {
  PING_CONCURRENCY,
  PING_TTL_AUTO_MS,
  PING_TTL_MANUAL_MS,
  PING_TTL_DEFAULT_MS,
  isPingEligibleProvider,
  type PingResult,
} from '$lib/constants/modelHealth'

export function isPingEligible(profile: APIProfile | undefined | null): boolean {
  if (!profile || !profile.pingEnabled || !profile.apiKey) return false
  return isPingEligibleProvider(profile.providerType)
}

export function shouldShowHealthFor(profile: APIProfile, modelId: string): boolean {
  if (profile.providerType === 'openrouter') return modelId.endsWith(':free')
  if (profile.providerType === 'nvidia-nim') return true
  return false
}

function pickModels(profile: APIProfile): string[] {
  const hiddenSet = new Set(profile.hiddenModels ?? [])
  const ids = new Set<string>()
  for (const m of profile.fetchedModels) ids.add(m.id)
  for (const m of profile.customModels) ids.add(m)
  return [...ids].filter((id) => !hiddenSet.has(id) && shouldShowHealthFor(profile, id))
}

/**
 * Minimal concurrency limiter. Returns a function that wraps tasks and
 * runs at most `n` concurrently.
 */
function pLimit(n: number) {
  const queue: Array<() => void> = []
  let active = 0
  const next = () => {
    active--
    if (queue.length > 0) {
      active++
      queue.shift()!()
    }
  }
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        fn().then(resolve, reject).finally(next)
      }
      if (active < n) {
        active++
        start()
      } else {
        queue.push(start)
      }
    })
  }
}

// Track active ping batches to prevent redundant parallel runs for the same profile
const activePingBatches = new Set<string>()

export async function clearProfileHealth(profile: APIProfile): Promise<void> {
  const apiKeyHash = await modelHealth.ensureHash(profile)
  await deleteModelHealthForKey(profile.providerType, apiKeyHash)
  modelHealth.clearForProfile(profile.providerType, apiKeyHash)
}

export async function pingProfileModels(
  profile: APIProfile,
  modelsFilter?: Set<string>,
  trigger: 'auto' | 'manual' = 'auto',
): Promise<void> {
  if (!isPingEligible(profile)) return

  // Synchronous lock check using profile ID to prevent async race conditions
  if (activePingBatches.has(profile.id)) {
    console.debug(`[modelHealth] Batch already in flight for profile ${profile.id}, skipping`)
    return
  }
  activePingBatches.add(profile.id)

  try {
    const baseUrl = getEffectiveBaseUrl(profile)
    if (!baseUrl) return

    const apiKeyHash = await modelHealth.ensureHash(profile)
    await modelHealth.hydrateFromDb(profile.providerType, apiKeyHash)

    const ttlMap = trigger === 'manual' ? PING_TTL_MANUAL_MS : PING_TTL_AUTO_MS
    const ttlMs = ttlMap[profile.providerType] ?? PING_TTL_DEFAULT_MS

    const allModels = pickModels(profile)
    const eligible = modelsFilter ? allModels.filter((id) => modelsFilter.has(id)) : allModels
    const toPing = eligible.filter((modelId) => {
      const cached = modelHealth.get(profile.providerType, modelId, apiKeyHash)
      return !cached || !isFresh(cached.checkedAt, ttlMs)
    })
    if (toPing.length === 0) return

    const limit = pLimit(PING_CONCURRENCY)
    const results = new Map<string, PingResult>()

    await Promise.all(
      toPing.map((modelId) =>
        limit(async () => {
          const result = await pingModel(baseUrl, profile.apiKey, modelId)
          results.set(modelId, result)
          if (result.status === 'rate_limited') {
            console.warn(`[modelHealth] ${profile.providerType} rate-limited on ${modelId}`)
          }
        }),
      ),
    )

    const checkedAt = Date.now()
    const rows: UpsertRow[] = [...results].map(([modelId, result]) => ({
      providerId: profile.providerType,
      modelId,
      apiKeyHash,
      result,
      checkedAt,
    }))

    await upsertBatch(rows)
    modelHealth.setMany(rows)
  } finally {
    activePingBatches.delete(profile.id)
  }
}

/**
 * Warm up the cache at app start. Pings only the models currently configured
 * in main narrative and generation presets (not every model in the profile).
 * De-duplicates on (providerType, normalizedBaseUrl, apiKeyHash).
 */
export async function warmupAllProfiles(): Promise<void> {
  const mainProfileId = settings.apiSettings.mainNarrativeProfileId

  // Collect (profileId → Set<modelId>) for models actually in use
  const usedModels = new Map<string, Set<string>>()
  function addUsed(profileId: string | null | undefined, model: string | null | undefined) {
    const pid = profileId || mainProfileId
    if (!pid || !model) return
    if (!usedModels.has(pid)) usedModels.set(pid, new Set())
    usedModels.get(pid)!.add(model)
  }

  addUsed(mainProfileId, settings.apiSettings.defaultModel)
  for (const preset of settings.generationPresets) {
    addUsed(preset.profileId, preset.model)
  }

  const profiles = settings.apiSettings.profiles.filter(isPingEligible)
  const seen = new Map<string, { profile: APIProfile; filter: Set<string> }>()
  const activeKeys = new Set<string>()

  await Promise.all(
    profiles.map(async (profile) => {
      const filter = usedModels.get(profile.id)
      if (!filter?.size) return

      const baseUrl = getEffectiveBaseUrl(profile)
      if (!baseUrl) return
      const apiKeyHash = await modelHealth.ensureHash(profile)
      activeKeys.add(`${profile.providerType}|${apiKeyHash}`)
      const dedupKey = `${profile.providerType}|${baseUrl}|${apiKeyHash}`
      if (!seen.has(dedupKey)) {
        seen.set(dedupKey, { profile, filter: new Set(filter) })
      } else {
        for (const m of filter) seen.get(dedupKey)!.filter.add(m)
      }
    }),
  )

  modelHealth.evictForeign(activeKeys, new Set(profiles.map((p) => p.id)))

  await Promise.all(
    [...seen.values()].map(({ profile, filter }) =>
      pingProfileModels(profile, filter).catch((err) =>
        console.warn(`[modelHealth] warmup failed for ${profile.name}:`, err),
      ),
    ),
  )
}
