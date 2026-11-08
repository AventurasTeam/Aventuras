import type { ImageModelCapabilities, ImageProviderConnection } from '#lib/types/index.ts'
import { createLogger } from '#lib/log.ts'
import { abortable } from '#lib/utils/async.ts'
import { modelListKey } from './connection'
import { pickCapabilities } from './modelCapabilities'

const log = createLogger('ImageRegistry')

/** Looks one model's capabilities up from its provider; rejects when the provider cannot be read. */
export type CapabilityLookup = (
  connection: ImageProviderConnection,
  model: string,
  signal?: AbortSignal,
) => Promise<ImageModelCapabilities | undefined>

// A model the list omits is answered by the provider, so its answer is kept as long as a list is.
const CAPABILITY_TTL_MS = 12 * 60 * 60 * 1000
const FAILURE_TTL_MS = 5 * 60 * 1000
const LOOKUP_TIMEOUT_MS = 10_000

interface Entry {
  capabilities: ImageModelCapabilities | undefined
  expiresAt: number
}

type Lookup = Promise<ImageModelCapabilities | undefined>

// Keyed by connection, then model, so a connection's answers drop together.
const entries = new Map<string, Map<string, Entry>>()
const pending = new Map<string, Map<string, Lookup>>()
// Bumped on every eviction, so a lookup that started earlier can tell its answer is out of date.
const epochs = new Map<string, number>()

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

function inner<T>(outer: Map<string, Map<string, T>>, key: string): Map<string, T> {
  let map = outer.get(key)
  if (!map) {
    map = new Map()
    outer.set(key, map)
  }
  return map
}

function store(key: string, model: string, entry: Entry): void {
  const now = Date.now()
  for (const [connectionKey, models] of entries) {
    for (const [name, cached] of models) if (now >= cached.expiresAt) models.delete(name)
    if (!models.size) entries.delete(connectionKey)
  }
  inner(entries, key).set(model, entry)
}

function settle(key: string, model: string, lookup: Lookup): void {
  const models = pending.get(key)
  if (models?.get(model) !== lookup) return
  models.delete(model)
  if (!models.size) pending.delete(key)
}

async function request(
  connection: ImageProviderConnection,
  model: string,
  lookup: CapabilityLookup,
  cacheFailure: boolean,
): Promise<ImageModelCapabilities | undefined> {
  const key = modelListKey(connection)
  const cached = entries.get(key)?.get(model)
  if (cached && Date.now() < cached.expiresAt) return cached.capabilities

  const inFlight = pending.get(key)?.get(model)
  if (inFlight) return inFlight

  const epoch = epochs.get(key) ?? 0
  // An answer from before an eviction is returned to its caller but not kept.
  const current = () => (epochs.get(key) ?? 0) === epoch
  const running: Lookup = (async () => {
    try {
      const found = await lookupWithin(LOOKUP_TIMEOUT_MS, (signal) =>
        lookup(connection, model, signal),
      )
      const capabilities = found && pickCapabilities(found)
      if (current()) {
        store(key, model, { capabilities, expiresAt: Date.now() + CAPABILITY_TTL_MS })
      }
      return capabilities
    } catch (error) {
      log('Error looking up model capabilities', {
        providerType: connection.providerType,
        model,
        error,
      })
      if (cacheFailure && current()) {
        store(key, model, { capabilities: undefined, expiresAt: Date.now() + FAILURE_TTL_MS })
      }
      return undefined
    }
  })().finally(() => settle(key, model, running))
  inner(pending, key).set(model, running)
  return running
}

/**
 * What the provider says about a model, looked up once per connection and model for 12 hours.
 * Callers read a model the list contains from the list; this holds the rest. A model the provider
 * does not know is cached as `undefined`; a failed lookup resolves to `undefined` and is not
 * retried for five minutes.
 */
export function cachedCapabilities(
  connection: ImageProviderConnection,
  model: string,
  lookup: CapabilityLookup,
): Promise<ImageModelCapabilities | undefined> {
  return request(connection, model, lookup, true)
}

/**
 * Fills the cache ahead of the first caller. A failure is logged and stores nothing, so the
 * first real caller looks up again instead of waiting out the five minutes. Never rejects.
 */
export async function primeCapabilities(
  connection: ImageProviderConnection,
  model: string,
  lookup: CapabilityLookup,
): Promise<void> {
  await request(connection, model, lookup, false)
}

/**
 * Drops the cached answers for a `modelListKey`. With `supersedeLookups`, a lookup still running
 * finishes for its caller but stores nothing, and the next caller starts its own.
 */
export function evictCapabilities(listKey: string, supersedeLookups = true): void {
  entries.delete(listKey)
  if (!supersedeLookups) return
  pending.delete(listKey)
  epochs.set(listKey, (epochs.get(listKey) ?? 0) + 1)
}
