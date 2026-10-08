import type { EntityImport, HappeningImport, LoreImport, ThreadImport } from '@/lib/avts'
import type { HappeningDraft, ThreadDraft } from '@/lib/plot'
import type { CharacterDraft, EntityBaseDraft, LoreDraft } from '@/lib/world'

import { saveHappening } from '../plot/save-happening'
import { saveThread } from '../plot/save-thread'
import type { RowSaveResult } from '../row-save/commit-row-save'
import type { DbCtx } from '../types'
import { saveEntity } from '../world/save-entity'
import { saveLore } from '../world/save-lore'

export type ImportRowResult = RowSaveResult

type CharacterImport = Extract<EntityImport, { kind: 'character' }>

function baseDraft(payload: EntityImport): EntityBaseDraft {
  return {
    name: payload.name,
    description: payload.description ?? '',
    status: payload.status,
    retiredReason: payload.retiredReason ?? '',
    injectionMode: payload.injectionMode,
    keywords: [...payload.keywords],
    tags: [...payload.tags],
    priority: payload.priority,
  }
}

function characterDraft(payload: CharacterImport): CharacterDraft {
  const { state } = payload
  return {
    ...baseDraft(payload),
    visualPhysique: state.visual.physique ?? '',
    visualFace: state.visual.face ?? '',
    visualHair: state.visual.hair ?? '',
    visualEyes: state.visual.eyes ?? '',
    visualAttire: state.visual.attire ?? '',
    visualDistinguishing: state.visual.distinguishing ?? '',
    traits: [...state.traits],
    drives: [...state.drives],
    voice: state.voice ?? '',
    currentLocationId: null,
    factionId: null,
    equippedItems: [],
    inventory: [],
    stackables: Object.entries(state.stackables ?? {}).map(([key, count]) => ({ key, count })),
    relationships: [],
  }
}

/** Creates the payload's entity on `branchId` through the World pane's create path. */
export function importEntity(
  branchId: string,
  payload: EntityImport,
  ctx: DbCtx,
): Promise<ImportRowResult> {
  // data-model.md → Aventuras file format: branch-local refs never travel.
  const create = { branchId, row: null, keywordsBase: [] }
  switch (payload.kind) {
    case 'character':
      return saveEntity(
        {
          ...create,
          kind: 'character',
          draft: characterDraft(payload),
          relationships: [],
          relationshipsBase: [],
        },
        ctx,
      )
    case 'location':
      return saveEntity(
        {
          ...create,
          kind: 'location',
          draft: {
            ...baseDraft(payload),
            parentLocationId: null,
            condition: payload.state.condition ?? '',
          },
        },
        ctx,
      )
    case 'item':
      return saveEntity(
        {
          ...create,
          kind: 'item',
          draft: {
            ...baseDraft(payload),
            atLocationId: null,
            condition: payload.state.condition ?? '',
          },
        },
        ctx,
      )
    case 'faction':
      return saveEntity(
        {
          ...create,
          kind: 'faction',
          draft: {
            ...baseDraft(payload),
            standing: payload.state.standing ?? '',
            agenda: [...(payload.state.agenda ?? [])],
          },
        },
        ctx,
      )
  }
}

/** Creates the payload's lore row on `branchId` through the lore pane's create path. */
export function importLore(
  branchId: string,
  payload: LoreImport,
  ctx: DbCtx,
): Promise<ImportRowResult> {
  const draft: LoreDraft = {
    title: payload.title,
    body: payload.body,
    category: payload.category ?? '',
    injectionMode: payload.injectionMode,
    priority: payload.priority,
    keywords: [...payload.keywords],
    tags: [...payload.tags],
  }
  return saveLore({ branchId, row: null, draft }, ctx)
}

/** Creates the payload's thread on `branchId` through the Plot pane's create path. */
export function importThread(
  branchId: string,
  payload: ThreadImport,
  ctx: DbCtx,
): Promise<ImportRowResult> {
  const draft: ThreadDraft = {
    title: payload.title,
    description: payload.description ?? '',
    category: payload.category ?? '',
    icon: payload.icon,
    status: payload.status,
    injectionMode: payload.injectionMode,
  }
  return saveThread({ branchId, row: null, draft }, ctx)
}

/** Creates the payload's happening on `branchId` alone: no entry anchor, no link rows. */
export function importHappening(
  branchId: string,
  payload: HappeningImport,
  ctx: DbCtx,
): Promise<ImportRowResult> {
  const draft: HappeningDraft = {
    title: payload.title,
    description: payload.description ?? '',
    category: payload.category ?? '',
    icon: payload.icon,
    commonKnowledge: payload.commonKnowledge === 1,
    occurredAtEntryId: null,
    temporal: payload.temporal ?? '',
    involvements: [],
    awareness: [],
  }
  return saveHappening(
    { branchId, row: null, links: { involvements: [], awareness: [] }, draft },
    ctx,
  )
}
