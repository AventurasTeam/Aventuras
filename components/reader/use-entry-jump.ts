import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { readEntriesBetween, readEntryPosition } from '@/lib/actions'
import type { DbCtx, StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import { entriesStore } from '@/lib/stores'
import { toast } from '@/lib/toast'

// Well past the 10.7 s a 60-chapter jump took to land on the Fold: a landing that never signals
// must not leave the veil blocking the reader, and an early lift only shows a busy one.
export const JUMP_VEIL_TIMEOUT_MS = 30_000

function oldestLoadedPosition(branchId: string): number | null {
  let oldest: number | null = null
  for (const row of entriesStore.getEntries().values()) {
    if (row.branchId === branchId && (oldest === null || row.position < oldest)) {
      oldest = row.position
    }
  }
  return oldest
}

/**
 * The rows from `position` up to the window, or null when `superseded` or the window is empty.
 * Rereads when the window moved during the read; a reload that shrank it would leave a gap.
 */
async function readToWindow(
  branchId: string,
  position: number,
  db: DbCtx['db'],
  superseded: () => boolean,
): Promise<StoryEntry[] | null> {
  let oldest = oldestLoadedPosition(branchId)
  while (oldest !== null) {
    const rows = await readEntriesBetween(branchId, position, oldest, db)
    if (superseded()) return null
    const oldestNow = oldestLoadedPosition(branchId)
    if (oldestNow === oldest) return rows
    oldest = oldestNow
  }
  return null
}

// Positions on a branch have no gaps: entries append at the tail and only a rollback deletes, from
// an entry to the tail (data-model.md → Entry mutability & rollback). No row above means the top.
function readsBranchTop(rows: readonly StoryEntry[], position: number): boolean {
  return rows.length > 0 && rows[0]!.position === position
}

/** A superseded jump is logged but not toasted: a newer jump or a branch change replaced it. */
function reportJumpFailure(
  branchId: string,
  entryId: string,
  error: unknown,
  superseded: boolean,
): void {
  logger.error('reader.entry_jump_failed', {
    branchId,
    entryId,
    error: error instanceof Error ? error.message : String(error),
  })
  if (!superseded) toast.error(t('reader:jumpFailed'))
}

// A jump whose landing signals sooner never shows the veil; until it shows, a gesture on the
// reader can be lost to the landing (reader-composer.md → Where a jump lands).
export const JUMP_VEIL_DELAY_MS = 200

/**
 * `isWaiting` while a jump that needed a read waits for the surface to signal its target
 * `landed`; `getSnapshot` (shown) only once it has waited JUMP_VEIL_DELAY_MS. Listeners hear both.
 */
export type JumpVeil = {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => boolean
  isWaiting: () => boolean
}

// Outside React state: on native a route render re-sends the whole window to the document.
function createJumpVeil(): JumpVeil & { wait: () => void; lift: () => void } {
  let waiting = false
  let shown = false
  let showTimer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => shown,
    isWaiting: () => waiting,
    // A newer jump keeps the wait it joins: the reader has been waiting since the first press.
    wait: () => {
      if (waiting) return
      waiting = true
      showTimer = setTimeout(() => {
        shown = true
        notify()
      }, JUMP_VEIL_DELAY_MS)
      notify()
    },
    lift: () => {
      if (!waiting) return
      waiting = false
      clearTimeout(showTimer)
      shown = false
      notify()
    },
  }
}

export function useJumpVeilUp(veil: JumpVeil): boolean {
  return useSyncExternalStore(veil.subscribe, veil.getSnapshot)
}

export type EntryJump = {
  jump: (entryId: string) => Promise<void>
  veil: JumpVeil
  landed: (entryId: string) => void
}

type JumpDropCause = 'bound' | 'left_window' | 'document_reload'

/**
 * `land` (platform dispatch) and `topLoaded` must be stable. `topLoaded` runs in the store write's
 * tick only when a read brings in a target that is the branch's first row, so the host drops its
 * shimmer in that commit.
 * `lost` reports a landing call for `entryId` that a document reload lost.
 */
export function useEntryJump(
  branchId: string,
  ctx: DbCtx,
  land: (entryId: string) => void,
  topLoaded: () => void,
): EntryJump & { lost: (entryId: string) => void } {
  const generationRef = useRef(0)
  const targetRef = useRef<string | null>(null)
  const [veil] = useState(createJumpVeil)
  const unwatchRef = useRef<() => void>(() => {})
  const unwatch = useCallback(() => {
    unwatchRef.current()
    unwatchRef.current = () => {}
  }, [])
  const release = useCallback(() => {
    targetRef.current = null
    unwatch()
    veil.lift()
  }, [unwatch, veil])
  const drop = useCallback(
    (entryId: string, cause: JumpDropCause) => {
      logger.warn('reader.entry_jump_dropped', { branchId, entryId, cause })
      release()
    },
    [branchId, release],
  )
  // The surface's landed signal may never come: its row can leave the window or never mount.
  const watchLanding = useCallback(
    (entryId: string) => {
      unwatch()
      const timer = setTimeout(() => drop(entryId, 'bound'), JUMP_VEIL_TIMEOUT_MS)
      const unsubscribe = entriesStore.subscribe(() => {
        if (entriesStore.getById(entryId)?.branchId === branchId) return
        // Another branch loading means the reader is being left, not that it dropped the landing.
        if (entriesStore.getLoadedBranch() === branchId) drop(entryId, 'left_window')
        else release()
      })
      unwatchRef.current = () => {
        clearTimeout(timer)
        unsubscribe()
      }
    },
    [branchId, drop, release, unwatch],
  )
  // A replaced target's drop still signals, and must not lift the veil mid-jump.
  const landed = useCallback(
    (entryId: string) => {
      if (targetRef.current === entryId) release()
    },
    [release],
  )
  const lost = useCallback(
    (entryId: string) => {
      if (targetRef.current === entryId) drop(entryId, 'document_reload')
    },
    [drop],
  )
  // A branch change unmounts the surface on both platforms, so a pending landing never signals; a
  // read still out then must not land or start a bound, even back on this branch.
  useEffect(
    () => () => {
      generationRef.current += 1
      release()
    },
    [branchId, release],
  )

  const jump = useCallback(
    async (entryId: string) => {
      generationRef.current += 1
      const generation = generationRef.current
      // A newer call owns the veil; a stop for any other reason lifts it.
      const current = () => generation === generationRef.current
      const superseded = () => !current() || entriesStore.getLoadedBranch() !== branchId

      const inWindow = entriesStore.getById(entryId)?.branchId === branchId
      try {
        if (inWindow) {
          // On native the host's store runs ahead of the document: lifting a running wait here
          // would unveil the old view until the document renders this row.
          if (veil.isWaiting()) {
            targetRef.current = entryId
            watchLanding(entryId)
          }
          land(entryId)
          return
        }
        unwatch()
        targetRef.current = entryId
        veil.wait()
        const position = await readEntryPosition(branchId, entryId, ctx.db)
        if (superseded()) {
          if (current()) release()
          return
        }
        if (position === null) {
          release()
          toast.warning(t('reader:jumpEntryGone'))
          return
        }
        // From the row above: a break hangs off the previous chapter's end row, so a chapter jump
        // lands under its heading only with that row loaded.
        const rows = await readToWindow(branchId, position - 1, ctx.db, superseded)
        if (rows === null) {
          if (current()) release()
          return
        }
        if (readsBranchTop(rows, position)) topLoaded()
        entriesStore.insertMany(branchId, rows)
        if (entriesStore.getById(entryId) === undefined) {
          release()
          toast.warning(t('reader:jumpEntryGone'))
          return
        }
        watchLanding(entryId)
        land(entryId)
      } catch (error) {
        if (current()) release()
        reportJumpFailure(branchId, entryId, error, superseded())
      }
    },
    [branchId, ctx, land, release, topLoaded, unwatch, veil, watchLanding],
  )

  return { jump, veil, landed, lost }
}
