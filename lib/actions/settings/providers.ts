import { eq, sql, type SQL } from 'drizzle-orm'

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

import { jsonArg, jsonMergeArrayElementById, jsonUpsertArrayElementById } from './json-write'
import type { DbCtx } from '../types'

async function persistConfig(
  ctx: DbCtx,
  patch: Partial<{
    providers: ProviderInstance[] | SQL
    profiles: ModelProfile[] | SQL
    assignments: Record<string, string>
    defaultProviderId: string | null
  }>,
): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .update(appSettings)
      .set(patch)
      .where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
      .toSQL(),
  ])
  const result = await rehydrateAppSettings(ctx.db)
  if (result.status !== 'ok') {
    throw new Error(`Failed to rehydrate app settings: ${result.error}`)
  }
}

export async function addProvider(provider: ProviderInstance, ctx: DbCtx): Promise<void> {
  const parsed = providerInstanceSchema.parse(provider)
  await persistConfig(ctx, {
    providers: sql`json_insert(${appSettings.providers}, '$[#]', ${jsonArg(parsed)})`,
  })
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
  // Only the patch is validated here; the merged row is re-parsed by
  // rehydrateAppSettings on read-back.
  const parsed = providerInstanceSchema.partial().parse(patch)
  await persistConfig(ctx, {
    providers: jsonMergeArrayElementById(appSettings.providers, id, parsed),
  })
}

// The nested upsert runs inside SQLite so two probes for different models on one
// provider cannot each persist a cachedModels snapshot taken before the other
// landed. Probe dedup (embedder.ts) is keyed by `providerId:modelId`, so those
// two calls are concurrent by design.
function upsertCachedModelCapabilities(
  providerId: string,
  modelId: string,
  embeddingDim: number,
): SQL {
  const patch = { capabilities: { embedding: true, embeddingDim } }
  const cached = sql`COALESCE(json_extract(prov.value, '$.cachedModels'), '[]')`
  return sql`(SELECT json_group_array(
    CASE WHEN json_extract(prov.value, '$.id') = ${providerId}
      THEN json_set(prov.value, '$.cachedModels', (
        SELECT json_group_array(json(merged)) FROM (
          SELECT CASE WHEN json_extract(model.value, '$.id') = ${modelId}
                      THEN json_patch(model.value, ${jsonArg(patch)})
                      ELSE model.value END AS merged
          FROM json_each(${cached}) model
          UNION ALL
          SELECT ${jsonArg({ id: modelId, ...patch })}
          WHERE NOT EXISTS (
            SELECT 1 FROM json_each(${cached}) probe
            WHERE json_extract(probe.value, '$.id') = ${modelId}))))
      ELSE prov.value END)
    FROM json_each(${appSettings.providers}) prov)`
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
  if (!appSettingsStore.getAppSettings().providers.some((p) => p.id === providerId)) {
    throw new Error(`Provider with id "${providerId}" not found`)
  }
  await persistConfig(ctx, {
    providers: upsertCachedModelCapabilities(providerId, modelId, embeddingDim),
  })
}

export async function setDefaultProvider(id: string | null, ctx: DbCtx): Promise<void> {
  await persistConfig(ctx, { defaultProviderId: id })
}

export async function upsertProfile(profile: ModelProfile, ctx: DbCtx): Promise<void> {
  const parsed = modelProfileSchema.parse(profile)
  await persistConfig(ctx, {
    profiles: jsonUpsertArrayElementById(appSettings.profiles, parsed.id, parsed),
  })
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
