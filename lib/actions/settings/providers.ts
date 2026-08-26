import { eq } from 'drizzle-orm'

import {
  AGENT_IDS,
  APP_SETTINGS_SINGLETON_ID,
  type ModelProfile,
  type ProviderInstance,
  appSettings,
  modelProfileSchema,
  providerInstanceSchema,
} from '@/lib/db'
import { generateId } from '@/lib/ids'
import { appSettingsStore, rehydrateAppSettings } from '@/lib/stores'

import type { DbCtx } from '../types'

async function persistConfig(
  ctx: DbCtx,
  patch: Partial<{
    providers: ProviderInstance[]
    profiles: ModelProfile[]
    assignments: Record<string, string>
    defaultProviderId: string | null
  }>,
): Promise<void> {
  await ctx.db.update(appSettings).set(patch).where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  const result = await rehydrateAppSettings(ctx.db)
  if (result.status !== 'ok') {
    throw new Error(`Failed to rehydrate app settings: ${result.error}`)
  }
}

export async function addProvider(provider: ProviderInstance, ctx: DbCtx): Promise<void> {
  const parsed = providerInstanceSchema.parse(provider)
  const current = appSettingsStore.getAppSettings().providers
  await persistConfig(ctx, { providers: [...current, parsed] })
}

export async function updateProvider(
  id: string,
  patch: Partial<ProviderInstance>,
  ctx: DbCtx,
): Promise<void> {
  const current = appSettingsStore.getAppSettings().providers
  if (!current.some((p) => p.id === id)) {
    throw new Error(`Provider with id "${id}" not found`)
  }
  const next = current.map((p) =>
    p.id === id ? providerInstanceSchema.parse({ ...p, ...patch }) : p,
  )
  await persistConfig(ctx, { providers: next })
}

const providerDimWrites = new Map<string, Promise<unknown>>()

// The probe dedup in embedder.ts is keyed by `providerId:modelId`, so two probes
// for DIFFERENT models on ONE provider run concurrently — and both read
// `cachedModels` off the store before either `updateProvider` lands, so the later
// write persists a snapshot missing the earlier dim. Scoped to this function: an
// `updateProvider` from another surface still races it.
function withProviderDimLock<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
  const prev = providerDimWrites.get(providerId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  providerDimWrites.set(
    providerId,
    next.catch(() => undefined),
  )
  return next
}

export async function recordProviderEmbeddingDim(
  providerId: string,
  modelId: string,
  embeddingDim: number,
  ctx: DbCtx,
): Promise<void> {
  if (!Number.isInteger(embeddingDim) || embeddingDim < 1) {
    throw new Error(`Invalid embedding dimension: ${embeddingDim}`)
  }
  await withProviderDimLock(providerId, async () => {
    const provider = appSettingsStore.getAppSettings().providers.find((p) => p.id === providerId)
    if (provider == null) throw new Error(`Provider with id "${providerId}" not found`)

    const cachedModels = [...(provider.cachedModels ?? [])]
    const index = cachedModels.findIndex((model) => model.id === modelId)
    const existing = index >= 0 ? cachedModels[index] : { id: modelId }
    const next = {
      ...existing,
      capabilities: {
        ...existing.capabilities,
        embedding: true,
        embeddingDim,
      },
    }
    if (index >= 0) cachedModels[index] = next
    else cachedModels.push(next)

    await updateProvider(providerId, { cachedModels }, ctx)
  })
}

export async function setDefaultProvider(id: string | null, ctx: DbCtx): Promise<void> {
  await persistConfig(ctx, { defaultProviderId: id })
}

export async function upsertProfile(profile: ModelProfile, ctx: DbCtx): Promise<void> {
  const parsed = modelProfileSchema.parse(profile)
  const current = appSettingsStore.getAppSettings().profiles
  const exists = current.some((p) => p.id === parsed.id)
  const next = exists ? current.map((p) => (p.id === parsed.id ? parsed : p)) : [...current, parsed]
  await persistConfig(ctx, { profiles: next })
}

export async function setAssignments(
  assignments: Record<string, string>,
  ctx: DbCtx,
): Promise<void> {
  await persistConfig(ctx, { assignments })
}

// One-control "use this model for narrative and agent tasks": creates a fresh
// narrative + agent profile, assigns ALL six agents to the agent profile, and
// sets the default provider. Replaces any existing profiles/assignments (the
// interim form owns exactly one provider in M2).
export async function quickWireModel(
  modelRef: { providerId: string; modelId: string },
  ctx: DbCtx,
): Promise<void> {
  const narrative: ModelProfile = modelProfileSchema.parse({
    id: generateId('prof'),
    kind: 'narrative',
    name: 'Narrative',
    modelRef,
  })
  const agent: ModelProfile = modelProfileSchema.parse({
    id: generateId('prof'),
    kind: 'agent',
    name: 'Agent tasks',
    modelRef,
    structuredOutput: 'auto',
  })
  const assignments: Record<string, string> = {}
  for (const id of AGENT_IDS) assignments[id] = agent.id

  await persistConfig(ctx, {
    profiles: [narrative, agent],
    assignments,
    defaultProviderId: modelRef.providerId,
  })
}
