import { useCallback, useEffect, useMemo, useState } from 'react'

import type { SceneEdit, SceneOptions } from '@/components/compounds/scene-edit-form'
import type { EditResult } from '@/components/reader/reader-document-types'
import { updateEntrySceneFields, type DbCtx } from '@/lib/actions'
import type { Entity, StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

/** An id the panel may mention, resolved to a display name where the row survives. */
export type ResolvedEntity = { id: string; name?: string }

export type SceneEditing = {
  /** Resolution pool for every id the panel renders — scene members, transfer
   *  counterparties, and a rejected location alike. */
  entityNames: ResolvedEntity[]
  sceneOptions: SceneOptions
  /** The only entry whose scene fields are editable; null when the branch is empty. */
  tailEntryId: string | null
  /** The entry whose host Sheet is open, with the scene it was opened on. */
  sceneEdit: {
    entryId: string
    sceneEntities: readonly string[]
    currentLocationId: string | null
  } | null
  editScene: (entryId: string, next: SceneEdit) => Promise<EditResult>
  requestEditScene: (entryId: string) => void
  closeSceneEdit: () => void
}

/**
 * Host half of the world-state panel's scene editor
 * (docs/ui/patterns/entry-card.md → Scene editor): name resolution for the
 * document, the candidate pool for the editor's selects, the tail rule, and the
 * phone tier's bridged-out Sheet.
 *
 * `entries` MUST be in ascending position order — the tail is read off the end.
 */
export function useSceneEditing(
  branchId: string,
  entries: StoryEntry[],
  entities: readonly Entity[],
  ctx: DbCtx,
): SceneEditing {
  // One pool covering every id the panel can mention. Deliberately not scoped to the
  // scene: a transfer's counterparty and a rejected location sit outside it, and
  // scoping would render them as unknown.
  const entityNames = useMemo(() => entities.map((e) => ({ id: e.id, name: e.name })), [entities])

  const sceneOptions = useMemo<SceneOptions>(
    () => ({
      characters: entities
        .filter((e) => e.kind === 'character')
        .map((e) => ({ id: e.id, name: e.name })),
      items: entities.filter((e) => e.kind === 'item').map((e) => ({ id: e.id, name: e.name })),
      locations: entities
        .filter((e) => e.kind === 'location')
        .map((e) => ({ id: e.id, name: e.name })),
    }),
    [entities],
  )

  // The tail rule lives here, not in the card: only this entry gets edit handlers, so
  // every other card renders no control at all rather than a disabled one. `system` is
  // skipped for the reason the action layer's gate skips it (scene-fields.ts): a failure
  // banner must not take the tail off the real last entry.
  const tailEntryId = useMemo(
    () => entries.findLast((e) => e.kind !== 'system')?.id ?? null,
    [entries],
  )

  const [sceneEditId, setSceneEditId] = useState<string | null>(null)

  // Failure rides the result channel, never the rejection channel: on native the
  // expo-dom bridge re-rejects into the WebView's own realm, which the app's
  // rejection handler never reaches, so an escaped rejection would leave Save inert.
  const editScene = useCallback(
    async (entryId: string, next: SceneEdit): Promise<EditResult> => {
      try {
        const result = await updateEntrySceneFields(branchId, entryId, next, ctx)
        if (result.status === 'ok') return { ok: true }
        logger.warn('action_layer.scene_edit_rejected', {
          branchId,
          entryId,
          reason: result.reason,
          code: result.code,
        })
        return { ok: false, ...(result.code !== undefined ? { code: result.code } : {}) }
      } catch (err) {
        logger.error('action_layer.scene_edit_failed', {
          branchId,
          entryId,
          error: err instanceof Error ? err.message : String(err),
        })
        return { ok: false }
      }
    },
    [branchId, ctx],
  )

  // Presented whatever the host's own tier is: EntryCard's useTier() measures the
  // reader document, not the device, so the card owns the fork.
  const requestEditScene = useCallback((entryId: string) => setSceneEditId(entryId), [])
  const closeSceneEdit = useCallback(() => setSceneEditId(null), [])

  const target = sceneEditId != null ? entries.find((e) => e.id === sceneEditId) : undefined
  // An undo, a rollback, a branch switch or a new turn can drop the entry under an
  // open sheet — or move the tail off it. Dropping the id with it keeps a later redo
  // from resurrecting the overlay on an entry that is no longer editable.
  useEffect(() => {
    if (sceneEditId != null && (target == null || sceneEditId !== tailEntryId)) setSceneEditId(null)
  }, [sceneEditId, target, tailEntryId])

  return {
    entityNames,
    sceneOptions,
    tailEntryId,
    sceneEdit:
      sceneEditId != null && target?.metadata != null
        ? {
            entryId: sceneEditId,
            sceneEntities: target.metadata.sceneEntities,
            currentLocationId: target.metadata.currentLocationId,
          }
        : null,
    editScene,
    requestEditScene,
    closeSceneEdit,
  }
}
