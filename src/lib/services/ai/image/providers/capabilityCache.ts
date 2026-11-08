import type { ImageModelCapabilities, ImageModelConnection } from '#lib/types/index.ts'
import { createLogger } from '#lib/log.ts'
import { abortable } from '#lib/utils/async.ts'
import { modelListKey } from './connection'
import { pickCapabilities } from './modelCapabilities'

const log = createLogger('ImageRegistry')

/** Looks one model's capabilities up from its provider; rejects when the provider cannot be read. */
export type CapabilityLookup = (
  connection: ImageModelConnection,
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

function settle(key: string, model: string): void {
  const models = pending.get(key)
  models?.delete(model)
  if (!models?.size) pending.delete(key)
}

/**
 * What the provider says about a model, looked up once per connection and model for 12 hours.
 * Callers read a model the list contains from the list; this holds the rest. A model the provider
 * does not know is cached as `undefined`; a failed lookup resolves to `undefined` and is not
 * retried for five minutes.
 */
export async function cachedCapabilities(
  connection: ImageModelConnection,
  model: string,
  lookup: CapabilityLookup,
): Promise<ImageModelCapabilities | undefined> {
  const key = modelListKey(connection)
  const cached = entries.get(key)?.get(model)
  if (cached && Date.now() < cached.expiresAt) return cached.capabilities

  const inFlight = pending.get(key)?.get(model)
  if (inFlight) return inFlight

  const request: Lookup = (async () => {
    let entry: Entry
    try {
      const found = await lookupWithin(LOOKUP_TIMEOUT_MS, (signal) =>
        lookup(connection, model, signal),
      )
      entry = {
        capabilities: found && pickCapabilities(found),
        expiresAt: Date.now() + CAPABILITY_TTL_MS,
      }
    } catch (error) {
      log('Error looking up model capabilities', {
        providerType: connection.providerType,
        model,
        error,
      })
      entry = { capabilities: undefined, expiresAt: Date.now() + FAILURE_TTL_MS }
    }
    store(key, model, entry)
    settle(key, model)
    return entry.capabilities
  })()
  inner(pending, key).set(model, request)
  return request
}

/** Drops the cached answers for a `modelListKey`; a lookup still running keeps its place and stores its own. */
export function evictCapabilities(listKey: string): void {
  entries.delete(listKey)
}
