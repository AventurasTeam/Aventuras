import { inheritedEntryMetadata, type EntityKind, type EntryMetadata } from '@/lib/db'

import { lastTwoReplies } from './replies'
import {
  SIGNAL_TARGET_TABLES,
  type RecentlyClassified,
  type RecentlyClassifiedSignals,
  type ReplyEdit,
  type RowCategory,
  type SignalDelta,
  type SignalEntry,
  type TurnBoundaries,
} from './types'

/*
 * patterns/entity.md → Recently-classified row accent. Tiers by log position of the
 * last two `ai_reply` creates (not `entry_id`: the periodic classifier anchors facts to
 * older turns).
 */

type Input = {
  deltas: readonly SignalDelta[]
  /** The last two replies' `user_edit` updates, ascending by log position. */
  replyEdits: readonly ReplyEdit[]
  /** Ascending by position. */
  entries: readonly SignalEntry[]
  boundaries: TurnBoundaries | null
  categoryOf: (entityId: string) => EntityKind | null
}

type SceneSource = Parameters<typeof inheritedEntryMetadata>[0]
type SceneFields = Pick<EntryMetadata, 'sceneEntities' | 'currentLocationId'>

function tierFor(logPosition: number, b: TurnBoundaries): RecentlyClassified | null {
  if (logPosition >= b.fresh) return 'fresh'
  if (b.fading != null && logPosition >= b.fading) return 'fading'
  return null
}

function stronger(
  current: RecentlyClassified | undefined,
  next: RecentlyClassified,
): RecentlyClassified {
  return current === 'fresh' || next === 'fresh' ? 'fresh' : 'fading'
}

// Same kind gate as selectInScene — never factions, unresolvable ids don't tint.
export function sceneTransitionIds(
  current: SceneSource,
  previous: SceneSource,
  categoryOf: (entityId: string) => EntityKind | null,
): string[] {
  const now = inheritedEntryMetadata(current)
  const before = inheritedEntryMetadata(previous)
  const isSceneMember = (id: string): boolean => {
    const kind = categoryOf(id)
    return kind === 'character' || kind === 'item'
  }
  const ids = new Set<string>()
  for (const id of now.sceneEntities) {
    if (!before.sceneEntities.includes(id) && isSceneMember(id)) ids.add(id)
  }
  for (const id of before.sceneEntities) {
    if (!now.sceneEntities.includes(id) && isSceneMember(id)) ids.add(id)
  }
  if (now.currentLocationId !== before.currentLocationId) {
    if (now.currentLocationId != null && categoryOf(now.currentLocationId) === 'location') {
      ids.add(now.currentLocationId)
    }
    if (before.currentLocationId != null && categoryOf(before.currentLocationId) === 'location') {
      ids.add(before.currentLocationId)
    }
  }
  return [...ids]
}

// An undo payload is the partial an edit replaced; a null `metadata` restores a NULL
// column, where both fields stood at their defaults.
function priorScene(undoPayload: unknown): Partial<SceneFields> {
  if (typeof undoPayload !== 'object' || undoPayload == null || !('metadata' in undoPayload)) {
    return {}
  }
  const { metadata } = undoPayload
  if (metadata === null) return { sceneEntities: [], currentLocationId: null }
  if (typeof metadata !== 'object') return {}
  const prior: Partial<SceneFields> = {}
  if ('sceneEntities' in metadata) {
    const ids = metadata.sceneEntities
    prior.sceneEntities = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
  }
  if ('currentLocationId' in metadata) {
    const id = metadata.currentLocationId
    prior.currentLocationId = typeof id === 'string' ? id : null
  }
  return prior
}

// Manual edits don't tint, so a reply's scene is diffed as the classifier left it: each
// field's earliest `user_edit` payload holds its value from before the user touched it.
function classifierScene(reply: SignalEntry, edits: readonly ReplyEdit[]): SceneSource {
  let prior: Partial<SceneFields> = {}
  for (const edit of edits) {
    if (edit.targetId === reply.id) prior = { ...priorScene(edit.undoPayload), ...prior }
  }
  return { ...inheritedEntryMetadata(reply.metadata), ...prior }
}

export function selectRecentlyClassified(input: Input): RecentlyClassifiedSignals {
  const rows = new Map<string, RecentlyClassified>()
  const byCategory = new Map<RowCategory, RecentlyClassified>()
  if (input.boundaries == null) return { rows, byCategory }

  const mark = (id: string, category: RowCategory | null, tier: RecentlyClassified) => {
    rows.set(id, stronger(rows.get(id), tier))
    if (category != null) byCategory.set(category, stronger(byCategory.get(category), tier))
  }

  for (const d of input.deltas) {
    if (d.source === 'user_edit') continue
    const table = SIGNAL_TARGET_TABLES.get(d.targetTable)
    if (table == null) continue
    const tier = tierFor(d.logPosition, input.boundaries)
    if (tier == null) continue
    mark(d.targetId, table === 'entity' ? input.categoryOf(d.targetId) : table, tier)
  }

  lastTwoReplies(input.entries).forEach(({ reply, before }, i) => {
    if (before == null) return
    const tier: RecentlyClassified = i === 0 ? 'fresh' : 'fading'
    const scene = classifierScene(reply, input.replyEdits)
    for (const id of sceneTransitionIds(scene, before.metadata, input.categoryOf)) {
      mark(id, input.categoryOf(id), tier)
    }
  })

  return { rows, byCategory }
}
