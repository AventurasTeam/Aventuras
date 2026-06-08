import { and, eq } from 'drizzle-orm'

import type { NewTranslation, Translation } from '@/lib/db'
import { translationWriteSchema, translations } from '@/lib/db'
import { translationsStore } from '@/lib/stores'

import { register, type ActionHandler } from '../delta/registry'
import type { DeltaSource } from '../types'

type TranslationUpdatePatch = Partial<{ translatedText: string }>

declare module '@/lib/actions/action-map' {
  interface PipelineActionMap {
    createTranslation: { source: DeltaSource; payload: { entry: NewTranslation } }
    updateTranslation: {
      source: DeltaSource
      payload: { branchId: string; id: string; patch: TranslationUpdatePatch }
    }
    deleteTranslation: { source: DeltaSource; payload: { branchId: string; id: string } }
  }
}

const UPDATABLE = ['translatedText'] as const

function fullRow(entry: NewTranslation): Translation {
  return {
    id: entry.id,
    branchId: entry.branchId,
    targetKind: entry.targetKind,
    targetId: entry.targetId,
    field: entry.field,
    language: entry.language,
    translatedText: entry.translatedText ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

const createHandler: ActionHandler = (action, branchId, ctx) => {
  if (action.kind !== 'createTranslation')
    throw new Error(`handler/kind mismatch: expected 'createTranslation', got '${action.kind}'`)
  const { entry } = action.payload
  if (entry.branchId !== branchId)
    return {
      status: 'rejected',
      reason: `branch mismatch: delta ${branchId} vs entry ${entry.branchId}`,
    }
  const row = fullRow(entry)
  const parsed = translationWriteSchema.safeParse(row)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid translation: ${parsed.error.message}` }
  return {
    status: 'ok',
    targetTable: 'translations',
    targetId: row.id,
    op: 'create',
    undoPayload: null,
    ops: [ctx.db.insert(translations).values(row).toSQL()],
    patch: { op: 'create', id: row.id, row },
  }
}

const updateHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'updateTranslation')
    throw new Error(`handler/kind mismatch: expected 'updateTranslation', got '${action.kind}'`)
  const { branchId: bid, id, patch } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const parsed = translationWriteSchema.partial().safeParse(patch)
  if (!parsed.success)
    return { status: 'rejected', reason: `invalid translation patch: ${parsed.error.message}` }
  const [current] = await ctx.db
    .select()
    .from(translations)
    .where(and(eq(translations.branchId, bid), eq(translations.id, id)))
  if (!current)
    return { status: 'rejected', reason: `update target translations ${bid}:${id} not found` }

  const set: Record<string, unknown> = {}
  const undoPayload: Record<string, unknown> = {}
  for (const col of UPDATABLE) {
    if (!(col in patch)) continue
    set[col] = patch[col]
    undoPayload[col] = current[col as keyof Translation]
  }
  if (Object.keys(set).length === 0)
    return {
      status: 'rejected',
      reason: `update patch for translations ${bid}:${id} has no updatable fields`,
    }

  return {
    status: 'ok',
    targetTable: 'translations',
    targetId: id,
    op: 'update',
    undoPayload,
    ops: [
      ctx.db
        .update(translations)
        .set(set)
        .where(and(eq(translations.branchId, bid), eq(translations.id, id)))
        .toSQL(),
    ],
    patch: { op: 'update', id, columns: set },
  }
}

const deleteHandler: ActionHandler = async (action, branchId, ctx) => {
  if (action.kind !== 'deleteTranslation')
    throw new Error(`handler/kind mismatch: expected 'deleteTranslation', got '${action.kind}'`)
  const { branchId: bid, id } = action.payload
  if (bid !== branchId)
    return { status: 'rejected', reason: `branch mismatch: delta ${branchId} vs target ${bid}` }
  const [current] = await ctx.db
    .select()
    .from(translations)
    .where(and(eq(translations.branchId, bid), eq(translations.id, id)))
  if (!current)
    return { status: 'rejected', reason: `delete target translations ${bid}:${id} not found` }
  return {
    status: 'ok',
    targetTable: 'translations',
    targetId: id,
    op: 'delete',
    undoPayload: { ...current },
    ops: [
      ctx.db
        .delete(translations)
        .where(and(eq(translations.branchId, bid), eq(translations.id, id)))
        .toSQL(),
    ],
    patch: { op: 'delete', id },
  }
}

export function registerTranslations(): void {
  register({
    table: 'translations',
    descriptor: { table: translations, idCol: translations.id, branchCol: translations.branchId },
    columnSchemas: {},
    handlers: {
      createTranslation: createHandler,
      updateTranslation: updateHandler,
      deleteTranslation: deleteHandler,
    },
    patcher: (branchId, p) => translationsStore.patch(branchId, p),
  })
}
