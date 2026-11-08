import { settings } from '#lib/stores/settings.svelte.ts'
import type {
  ImageModelCapabilities,
  ImageModelConnection,
  ImageProfile,
} from '#lib/types/index.ts'
import { createLogger } from '#lib/log.ts'
import { abortable } from '#lib/utils/async.ts'
import { modelListKey } from './connection'
import { IMAGE_MODEL_SNAPSHOT_VERSION, snapshotModel } from './modelCapabilities'

const log = createLogger('ImageRegistry')

/** Looks one model's capabilities up from its provider; rejects when the provider cannot be read. */
export type CapabilityLookup = (
  connection: ImageModelConnection,
  model: string,
  signal?: AbortSignal,
) => Promise<ImageModelCapabilities | undefined>

const BACKFILL_TIMEOUT_MS = 10_000
const failedBackfills = new Set<string>()
const pendingBackfills = new Map<string, Promise<ImageModelCapabilities | undefined>>()

/** Runs `lookup` for at most `ms`: the signal cancels its requests, and `abortable` stops waiting on one that ignores it. */
async function lookupWithin<T>(
  ms: number,
  lookup: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException(`Timed out after ${ms} ms`, 'AbortError')),
    ms,
  )
  try {
    return await abortable(lookup(controller.signal), controller.signal)
  } finally {
    clearTimeout(timer)
  }
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
      const found = await lookupWithin(BACKFILL_TIMEOUT_MS, (signal) =>
        lookup(profile, model, signal),
      )
      const next = snapshotModel(model, found)
      const current = settings.getImageProfile(profile.id)
      if (current?.model === model && modelListKey(current) === modelListKey(profile)) {
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
