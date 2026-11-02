import { settings } from '#lib/stores/settings.svelte.ts'
import type { ImageModelCapabilities, ImageProfile } from '#lib/types/index.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { createLogger } from '#lib/log.ts'
import { IMAGE_MODEL_SNAPSHOT_VERSION, snapshotModel } from './modelSnapshot'

const log = createLogger('ImageRegistry')

/** Looks one model's capabilities up from its provider; rejects when the provider cannot be read. */
export type CapabilityLookup = (
  profile: ImageProfile,
  model: string,
) => Promise<ImageModelCapabilities | undefined>

const BACKFILL_TIMEOUT_MS = 10_000
const failedBackfills = new Set<string>()
const pendingBackfills = new Map<string, Promise<ImageModelCapabilities | undefined>>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** From the profile's snapshot; a legacy or outdated one is looked up once. */
export async function snapshotCapabilities(
  profile: ImageProfile,
  model: string,
  lookup: CapabilityLookup,
): Promise<ImageModelCapabilities | undefined> {
  const snapshot = profile.modelSnapshot?.model === model ? profile.modelSnapshot : undefined
  if (snapshot?.version === IMAGE_MODEL_SNAPSHOT_VERSION) return snapshot.capabilities

  const key = `${profile.id}:${model}`
  if (failedBackfills.has(key)) return snapshot?.capabilities

  const pending = pendingBackfills.get(key)
  if (pending) return pending

  const backfill = (async () => {
    try {
      const found = await withTimeout(lookup(profile, model), BACKFILL_TIMEOUT_MS)
      const next = snapshotModel(model, found)
      const current = settings.getImageProfile(profile.id)
      if (
        current?.model === model &&
        current.providerType === profile.providerType &&
        current.apiKey === profile.apiKey &&
        normalizeBaseUrl(current.baseUrl) === normalizeBaseUrl(profile.baseUrl)
      ) {
        try {
          await settings.updateImageProfile(profile.id, { modelSnapshot: next })
        } catch (error) {
          log('Error saving model snapshot', { profileId: profile.id, error })
        }
      }
      return next.capabilities
    } catch (error) {
      log('Error looking up model capabilities', { profileId: profile.id, model, error })
      failedBackfills.add(key)
      return snapshot?.capabilities
    } finally {
      pendingBackfills.delete(key)
    }
  })()
  pendingBackfills.set(key, backfill)
  return backfill
}
