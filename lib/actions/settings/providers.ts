import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

import {
  AGENT_IDS,
  APP_SETTINGS_SINGLETON_ID,
  type ModelProfile,
  type ProviderInstance,
  appSettings,
  modelProfileSchema,
  providerInstanceSchema,
} from '@/lib/db'
import { appSettingsStore, rehydrateAppSettings } from '@/lib/stores'

import type { SettingsActionCtx } from './types'

async function persistConfig(
  ctx: SettingsActionCtx,
  patch: Partial<{
    providers: ProviderInstance[]
    profiles: ModelProfile[]
    assignments: Record<string, string>
    defaultProviderId: string | null
  }>,
): Promise<void> {
  await ctx.db.update(appSettings).set(patch).where(eq(appSettings.id, APP_SETTINGS_SINGLETON_ID))
  await rehydrateAppSettings(ctx.db)
}

export async function addProvider(
  provider: ProviderInstance,
  ctx: SettingsActionCtx,
): Promise<void> {
  const parsed = providerInstanceSchema.parse(provider)
  const current = appSettingsStore.getAppSettings().providers
  await persistConfig(ctx, { providers: [...current, parsed] })
}

export async function updateProvider(
  id: string,
  patch: Partial<ProviderInstance>,
  ctx: SettingsActionCtx,
): Promise<void> {
  const current = appSettingsStore.getAppSettings().providers
  const next = current.map((p) =>
    p.id === id ? providerInstanceSchema.parse({ ...p, ...patch }) : p,
  )
  await persistConfig(ctx, { providers: next })
}

export async function setDefaultProvider(id: string | null, ctx: SettingsActionCtx): Promise<void> {
  await persistConfig(ctx, { defaultProviderId: id })
}

export async function upsertProfile(profile: ModelProfile, ctx: SettingsActionCtx): Promise<void> {
  const parsed = modelProfileSchema.parse(profile)
  const current = appSettingsStore.getAppSettings().profiles
  const exists = current.some((p) => p.id === parsed.id)
  const next = exists ? current.map((p) => (p.id === parsed.id ? parsed : p)) : [...current, parsed]
  await persistConfig(ctx, { profiles: next })
}

export async function setAssignments(
  assignments: Record<string, string>,
  ctx: SettingsActionCtx,
): Promise<void> {
  await persistConfig(ctx, { assignments })
}

// One-control "use this model for narrative and agent tasks": creates a fresh
// narrative + agent profile, assigns ALL six agents to the agent profile, and
// sets the default provider. Replaces any existing profiles/assignments (the
// interim form owns exactly one provider in M2).
export async function quickWireModel(
  modelRef: { providerId: string; modelId: string },
  ctx: SettingsActionCtx,
): Promise<void> {
  const narrative: ModelProfile = modelProfileSchema.parse({
    id: ulid(),
    kind: 'narrative',
    name: 'Narrative',
    modelRef,
  })
  const agent: ModelProfile = modelProfileSchema.parse({
    id: ulid(),
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
