import { eq } from 'drizzle-orm'

import type { ProviderInstanceWithStub } from '@/lib/ai'
import {
  branches,
  entities,
  entryMetadataSchema,
  lore,
  stories,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  wizardSessions,
  type EmbeddedFieldRow,
  type EntityKind,
  type EntityState,
  type EntryMetadata,
  type SqlOp,
  type StoryDefinition,
  type StorySettings,
  type WizardLoreDraft,
} from '@/lib/db'
import { embedAndBuildVecOps, type EmbedderConfig } from '@/lib/embedder'
import { generateId } from '@/lib/ids'

import type { DbCtx } from '../types'

/** One wizard-authored entity row, already mapped to its per-kind `state` shape. */
export type WizardCastEntityInput = {
  id: string
  kind: EntityKind
  name: string
  description: string | null
  /** `retired` is unreachable at wizard time (canon). */
  status: 'active' | 'staged'
  tags: readonly string[]
  state: EntityState
}

export type CreateStoryInput = {
  storyId?: string
  // Draft-promote seam: storyId names an existing draft (a status='draft'
  // stories row + a wizard_sessions row keyed by the same id). When set, the
  // draft's rows are deleted as the first ops of the same transaction as the
  // fresh insert, so a failed commit leaves the draft untouched.
  replaceExistingStoryId?: boolean
  title: string
  description?: string
  definition: StoryDefinition
  settings: StorySettings
  openingContent: string
  openingMetadata: EntryMetadata
  /** Wizard-authored cast (Slice 3.6b). Each row embeds name + description. */
  cast?: readonly WizardCastEntityInput[]
  /** Wizard-authored initial lore (Slice 3.6a). Each row embeds title + body. */
  lore?: readonly WizardLoreDraft[]
  // Embed step (wizard Finish hard gate): when present, the cast's and lore rows'
  // vec ops are spliced into the atomic batch as ONE batched call (Contract C5 —
  // no second embed path). An embed failure throws OUT of here before
  // runInTransaction runs, so the batch never executes and nothing persists —
  // that IS the rollback (the transaction is one single-RPC batch).
  embed?: {
    config: EmbedderConfig
    exec: (sql: string) => Promise<void>
    provider?: ProviderInstanceWithStub
  }
}

export async function createStoryWithBranch(
  input: CreateStoryInput,
  ctx: DbCtx,
  nowMs: number = Date.now(),
): Promise<{ storyId: string; branchId: string }> {
  const definition = storyDefinitionSchema.parse(input.definition)
  const settings = storySettingsSchema.parse(input.settings)
  const metadata = entryMetadataSchema.parse(input.openingMetadata)

  // leadEntityId lives in JSON, so no FK guards a definition whose lead is never
  // materialized as an entity row — reject before the write instead of committing a dangling ref.
  if (
    definition.leadEntityId != null &&
    !(input.cast ?? []).some((r) => r.id === definition.leadEntityId && r.kind === 'character')
  ) {
    throw new Error('definition.leadEntityId requires a matching cast character')
  }

  const storyId = input.storyId ?? generateId('story')
  const branchId = generateId('br')
  const openingId = generateId('entry')

  const ops: SqlOp[] = []
  if (input.replaceExistingStoryId && input.storyId) {
    ops.push(
      ctx.db.delete(stories).where(eq(stories.id, input.storyId)).toSQL(),
      ctx.db.delete(wizardSessions).where(eq(wizardSessions.id, input.storyId)).toSQL(),
    )
  }

  ops.push(
    ctx.db
      .insert(stories)
      .values({
        id: storyId,
        title: input.title,
        description: input.description ?? null,
        status: 'active',
        definition,
        settings,
        currentBranchId: branchId,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .toSQL(),
    ctx.db
      .insert(branches)
      .values({ id: branchId, storyId, name: 'main', createdAt: nowMs })
      .toSQL(),
  )

  for (const row of input.cast ?? []) {
    ops.push(
      ctx.db
        .insert(entities)
        .values({
          id: row.id,
          branchId,
          kind: row.kind,
          name: row.name,
          description: row.description,
          status: row.status,
          injectionMode: 'auto',
          state: row.state,
          tags: [...row.tags],
          // Dirty by default: the same-batch splice below is what clears it. If a
          // future reorder or a caller that omits `embed` ever skips the splice,
          // the row stays flagged for the sync/drain stage instead of silently
          // defaulting to 0 and going permanently invisible to retrieval.
          embeddingStale: 1,
          createdAt: nowMs,
          updatedAt: nowMs,
        })
        .toSQL(),
    )
  }

  ops.push(
    ctx.db
      .insert(storyEntries)
      .values({
        id: openingId,
        branchId,
        position: 1,
        kind: 'opening',
        content: input.openingContent,
        metadata,
        createdAt: nowMs,
      })
      .toSQL(),
  )

  for (const row of input.lore ?? []) {
    const category = row.category.trim()
    ops.push(
      ctx.db
        .insert(lore)
        .values({
          id: row.id,
          branchId,
          title: row.title,
          body: row.body,
          category: category.length > 0 ? category : null,
          tags: [...row.tags],
          keywords: [],
          injectionMode: row.injectionMode,
          priority: row.priority,
          // Dirty by default — see the cast-entity insert above for why.
          embeddingStale: 1,
          createdAt: nowMs,
          updatedAt: nowMs,
        })
        .toSQL(),
    )
  }

  // Splice AFTER the entities/lore INSERTs: embedAndBuildVecOps's per-row
  // stale-clear UPDATE assumes its source row already sits earlier in the same
  // batch. Cast + lore share one call (Contract C5) so neither costs a
  // second provider round-trip.
  if (input.embed) {
    const rows: EmbeddedFieldRow[] = []
    for (const row of input.cast ?? []) {
      rows.push({ kind: 'entity', id: row.id, branchId, fields: [row.name, row.description] })
    }
    for (const row of input.lore ?? []) {
      rows.push({ kind: 'lore', id: row.id, branchId, fields: [row.title, row.body] })
    }
    if (rows.length > 0) {
      const vecOps = await embedAndBuildVecOps(
        input.embed.config,
        rows,
        input.embed.exec,
        input.embed.provider,
      )
      ops.push(...vecOps)
    }
  }

  await ctx.runInTransaction(ops)
  return { storyId, branchId }
}
