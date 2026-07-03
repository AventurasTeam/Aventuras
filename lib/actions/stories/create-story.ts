import { eq } from 'drizzle-orm'

import {
  branches,
  emptyEntityState,
  entities,
  entryMetadataSchema,
  stories,
  storyDefinitionSchema,
  storyEntries,
  storySettingsSchema,
  wizardSessions,
  type EntryMetadata,
  type SqlOp,
  type StoryDefinition,
  type StorySettings,
} from '@/lib/db'
import { generateId } from '@/lib/ids'

import type { DbCtx } from '../types'

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
  lead?: { id: string; name: string }
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
  if (definition.leadEntityId != null && input.lead == null) {
    throw new Error('definition.leadEntityId requires a lead entity')
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

  if (input.lead) {
    if (definition.leadEntityId !== input.lead.id) {
      throw new Error('lead.id must equal definition.leadEntityId')
    }
    ops.push(
      ctx.db
        .insert(entities)
        .values({
          id: input.lead.id,
          branchId,
          kind: 'character',
          name: input.lead.name,
          status: 'active',
          injectionMode: 'auto',
          state: emptyEntityState('character'),
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

  await ctx.runInTransaction(ops)
  return { storyId, branchId }
}
