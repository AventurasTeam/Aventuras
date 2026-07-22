import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { StorySettingsStaleStoreError } from '@/lib/actions'
import type { StorySettings } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import {
  computeSnapshot,
  removeSection,
  upsertSection,
  type SaveSessionSnapshot,
  type SectionDirtyState,
} from './save-session-state'
import { type StorySettingsTabId } from './tabs'

// Node (vitest) leaves __DEV__ undefined, so the check runs there too.
const DEV_CHECKS = typeof __DEV__ === 'undefined' || __DEV__

type SectionCallbacks = {
  getPatch: () => Partial<StorySettings>
  reset: () => void
}

type SaveSessionApi = {
  snapshot: SaveSessionSnapshot
  saving: boolean
  /**
   * Resolves `true` when the write landed, or when there was nothing to write.
   * `false` means it was rejected, or a commit was already in flight and this
   * call was turned away; either way the caller must not proceed. A failure
   * *after* the write lands never reports `false` — it is logged, because the
   * data is on disk.
   *
   * `true` does not promise a clean session: an edit made while the commit was
   * in flight survives it and stays dirty. A caller that needs cleanliness must
   * check `snapshot` rather than infer it from here.
   */
  save: () => Promise<boolean>
  discard: () => void
  requestLeave: (proceed: () => void) => void
  pendingLeave: boolean
  resolveLeave: (outcome: 'save' | 'discard' | 'cancel') => void
}

/** Section-only wiring. Split off `SaveSessionApi` so a consumer of the
 *  session can't publish dirty state without registering callbacks for it. */
type SectionRegistry = {
  publish: (state: SectionDirtyState) => void
  unpublish: (id: string) => void
  attach: (id: string, callbacks: { current: SectionCallbacks }) => () => void
}

const SaveSessionContext = createContext<SaveSessionApi | null>(null)
const SectionRegistryContext = createContext<SectionRegistry | null>(null)

function dirtyIds(sections: readonly SectionDirtyState[]): Set<string> {
  return new Set(sections.filter((s) => s.dirtyFields.length > 0).map((s) => s.id))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Identifies a section's draft at a point in time. Both sides always come from
 * the same `getPatch`, so key order matches; a reordering would read as
 * "changed", which only skips a reset — it can never discard an edit.
 */
function patchSignature(patch: Partial<StorySettings>): string {
  return JSON.stringify(patch)
}

function reportKeyCollision(
  owners: Map<string, string>,
  id: string,
  patch: Partial<StorySettings>,
): void {
  for (const key of Object.keys(patch)) {
    const owner = owners.get(key)
    if (owner === undefined) {
      owners.set(key, id)
      continue
    }
    const message = `Story Settings sections "${owner}" and "${id}" both patch the top-level key "${key}". The merge is shallow, so one clobbers the other and the winner depends on mount order.`
    // A wiring error, not a runtime condition: the screen doc assigns each
    // top-level key to exactly one tab. Dev throws, which refuses the save
    // rather than clobbering; prod logs and merges, since refusing every save
    // is worse than a shallow one when `stories` carries no delta to undo.
    if (DEV_CHECKS) throw new Error(message)
    logger.error('action_layer.story_settings_key_collision', { owner, sectionId: id, key })
  }
}

type ProviderProps = {
  /**
   * Commits the merged patch from every dirty section as ONE write. The
   * provider never calls this more than once per save, and never with an empty
   * patch.
   */
  onCommit: (patch: Partial<StorySettings>) => Promise<unknown>
  onSaved?: () => void
  onSaveFailed?: (error: unknown) => void
  children: ReactNode
}

export function StorySettingsSaveSessionProvider({
  onCommit,
  onSaved,
  onSaveFailed,
  children,
}: ProviderProps) {
  const [sections, setSections] = useState<readonly SectionDirtyState[]>([])
  const [saving, setSaving] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)

  // `saving` state lands a tick late, so only a ref can turn away a second entry
  // synchronously — Cmd-S can race the leave guard's own save.
  const savingRef = useRef(false)

  // Callbacks live in refs, never in state: sections hand us fresh closures on
  // every render and storing them would re-render the whole surface each time.
  const callbacksRef = useRef(new Map<string, { current: SectionCallbacks }>())

  const publish = useCallback((state: SectionDirtyState) => {
    setSections((prev) => upsertSection(prev, state))
  }, [])

  const unpublish = useCallback((id: string) => {
    setSections((prev) => removeSection(prev, id))
  }, [])

  const attach = useCallback((id: string, callbacks: { current: SectionCallbacks }) => {
    const map = callbacksRef.current
    // Every registry here is id-keyed, so two live sections sharing an id are
    // indistinguishable: the second overwrites the first's callbacks and its
    // published dirty fields, and `unpublish` then strips the pair on either
    // unmount. Nothing can reconstruct the loser, so this is a wiring error to
    // fail on, not a state to recover from.
    if (DEV_CHECKS && map.has(id)) {
      throw new Error(
        `Two Story Settings sections registered the id "${id}". Section ids must be unique across the surface.`,
      )
    }
    map.set(id, callbacks)
    return () => {
      // A remount can attach the replacement before this cleanup runs; without
      // the identity check it would delete the live registration.
      if (map.get(id) === callbacks) map.delete(id)
    }
  }, [])

  const snapshot = useMemo(() => computeSnapshot(sections), [sections])

  // Read at save time rather than closed over, so a consumer holding a stale
  // `api` still merges against the newest published dirty state.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections

  const pendingLeaveRef = useRef(pendingLeave)
  pendingLeaveRef.current = pendingLeave

  // `ids` undefined resets every section (Discard); a set resets only what a
  // save committed, so an edit made mid-commit isn't reverted with it.
  const resetSections = useCallback((ids?: ReadonlySet<string>) => {
    for (const [id, entry] of callbacksRef.current.entries()) {
      if (ids != null && !ids.has(id)) continue
      try {
        entry.current.reset()
      } catch (error) {
        // Isolated: one section's failure must not strand the rest mid-reset.
        logger.error('action_layer.story_settings_reset_failed', {
          sectionId: id,
          error: errorMessage(error),
        })
      }
    }
  }, [])

  const settlePendingLeave = useCallback(() => {
    const proceed = pendingLeaveRef.current
    if (proceed == null) return
    setPendingLeave(null)
    try {
      proceed()
    } catch (error) {
      logger.error('action_layer.story_settings_leave_failed', { error: errorMessage(error) })
    }
  }, [])

  const save = useCallback(async () => {
    if (savingRef.current) return false

    // Clean sections are skipped rather than trusted to return `{}`: every
    // panel stays mounted so a draft survives a tab switch, so an
    // unconditional getPatch would write a never-visited tab's mount-time
    // values over whatever changed them since.
    const dirty = dirtyIds(sectionsRef.current)
    // Nothing to write. A leave waiting on this is already satisfied — the
    // session is clean — so proceed rather than stranding it.
    if (dirty.size === 0) {
      settlePendingLeave()
      return true
    }

    // What each section's draft looked like when its patch was read, so an
    // edit made while the write was in flight isn't re-derived away after it.
    const committed = new Map<string, string>()

    savingRef.current = true
    setSaving(true)
    try {
      // One merged write, not a commit per section: `stories` carries no delta,
      // so a mid-way failure across N writes would strand earlier sections
      // persisted with no way to undo them.
      let merged: Partial<StorySettings> = {}
      const owners = new Map<string, string>()
      for (const [id, entry] of callbacksRef.current.entries()) {
        if (!dirty.has(id)) continue
        let patch: Partial<StorySettings>
        try {
          patch = entry.current.getPatch()
        } catch (error) {
          // Name the offender: otherwise a section's serialization bug is
          // indistinguishable from a DB failure.
          throw new Error(`Story Settings section "${id}" failed to build its patch`, {
            cause: error,
          })
        }
        reportKeyCollision(owners, id, patch)
        committed.set(id, patchSignature(patch))
        merged = { ...merged, ...patch }
      }
      await onCommit(merged)
    } catch (error) {
      onSaveFailed?.(error)
      // The write landed and only the store re-read failed, so this is not a
      // save failure. Sections keep their drafts — resetting would re-derive
      // them from a store still holding pre-save values — but the data is on
      // disk, so a leave waiting on this save must not be refused, and the
      // still-dirty sections below must not talk it out of settling.
      if (error instanceof StorySettingsStaleStoreError) {
        settlePendingLeave()
        return true
      }
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }

    // Past the commit — the write is on disk, so nothing below may report a
    // save failure, and each step is isolated so one failure can't strand the
    // rest. A section that didn't move re-derives its draft from the
    // now-updated store, so it lands clean without tracking a save baseline.
    const persisted = new Set<string>()
    for (const [id, entry] of callbacksRef.current.entries()) {
      const before = committed.get(id)
      if (before === undefined) continue
      try {
        if (patchSignature(entry.current.getPatch()) === before) persisted.add(id)
      } catch (error) {
        // Treat an unreadable draft as changed: skipping a reset costs a stale
        // save bar, resetting one the user has moved on from costs their edit.
        logger.error('action_layer.story_settings_reset_check_failed', {
          sectionId: id,
          error: errorMessage(error),
        })
      }
    }
    resetSections(persisted)
    try {
      onSaved?.()
    } catch (error) {
      logger.error('action_layer.story_settings_post_commit_failed', {
        error: errorMessage(error),
      })
    }
    // Any save satisfies a waiting leave, not just the one the guard started —
    // the back arrow stays live during a commit. Only once the session is
    // actually clean, though: an edit that landed mid-write is still unsaved,
    // and proceeding would drop it.
    const stillDirty = [...dirtyIds(sectionsRef.current)].some((id) => !persisted.has(id))
    if (!stillDirty) settlePendingLeave()
    return true
  }, [onCommit, onSaved, onSaveFailed, resetSections, settlePendingLeave])

  const discard = useCallback(() => {
    // A commit in flight owns the outcome, same as `resolveLeave`: the write
    // lands regardless, so reverting the drafts here would leave the session
    // clean and showing the values the user just asked to throw away.
    if (savingRef.current) {
      logger.warn('action_layer.story_settings_discard_ignored', {})
      return
    }
    resetSections()
  }, [resetSections])

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (snapshot.dirtyFields.length === 0) {
        proceed()
        return
      }
      setPendingLeave(() => proceed)
    },
    [snapshot],
  )

  const resolveLeave = useCallback(
    (outcome: 'save' | 'discard' | 'cancel') => {
      // A commit in flight owns the outcome; the dialog's disabled buttons are
      // presentation, not enforcement.
      if (savingRef.current) {
        logger.warn('action_layer.story_settings_leave_ignored', { outcome })
        return
      }
      const proceed = pendingLeave
      if (proceed == null || outcome === 'cancel') {
        setPendingLeave(null)
        return
      }
      if (outcome === 'discard') {
        setPendingLeave(null)
        discard()
        proceed()
        return
      }
      // The guard outlives the commit — save() clears it once the session is
      // actually clean — so it can disable itself while the write runs. A
      // failure, or an edit that landed mid-write, leaves the user on the same
      // three choices rather than dropping the navigation they asked for.
      void save()
    },
    [pendingLeave, discard, save],
  )

  const api = useMemo<SaveSessionApi>(
    () => ({
      snapshot,
      saving,
      save,
      discard,
      requestLeave,
      pendingLeave: pendingLeave != null,
      resolveLeave,
    }),
    [snapshot, saving, save, discard, requestLeave, pendingLeave, resolveLeave],
  )

  const registry = useMemo<SectionRegistry>(
    () => ({ publish, unpublish, attach }),
    [publish, unpublish, attach],
  )

  return (
    <SaveSessionContext.Provider value={api}>
      <SectionRegistryContext.Provider value={registry}>{children}</SectionRegistryContext.Provider>
    </SaveSessionContext.Provider>
  )
}

export function useStorySettingsSaveSession(): SaveSessionApi {
  const api = useContext(SaveSessionContext)
  if (api == null) {
    throw new Error(
      'useStorySettingsSaveSession must be used inside StorySettingsSaveSessionProvider',
    )
  }
  return api
}

type SectionRegistration = {
  id: string
  /** Owning tab. Its rail position drives this section's save-bar label order. */
  tab: StorySettingsTabId
  /**
   * User-recognizable labels, e.g. `['suggestions', 'suggestion count']`.
   * Empty means clean, which also gates whether the save merges this section.
   */
  dirtyFields: readonly string[]
  /**
   * This section's contribution to the surface's single save. Called only
   * during a save, so it may close over draft state freely, but called
   * **twice** per save — once to build the write, once after it lands to check
   * whether the draft moved while it was in flight. Keep it free of side
   * effects. The provider skips sections whose `dirtyFields` is empty, so this
   * never runs while clean — return this section's whole slice,
   * unconditionally.
   *
   * Sections must own disjoint **top-level** `StorySettings` keys. Every value
   * is replaced wholesale — nested objects and arrays included — so two
   * sections contributing different parts of one key clobber each other. A
   * collision is logged in every build.
   */
  getPatch: () => Partial<StorySettings>
  /**
   * Drop this section's local draft so it re-derives from the `settings` the
   * surface passes down. Fires on Discard, and after a save for each section
   * whose draft still matches what that save wrote — a section the user kept
   * editing during the commit is left alone and stays dirty.
   *
   * Reading the `settings` prop here is correct: `updateStorySettings`
   * refreshes `storiesStore` inside the awaited commit, and React flushes that
   * store-driven re-render before this runs, so the closure held here is
   * already the post-save one. That ordering is why the callback ref below is
   * written during render — moving it into an effect would leave this reading
   * pre-save values.
   */
  reset: () => void
}

/**
 * Joins a section to the surface's save session. Call from inside the section
 * component; it may be called with fresh arrays and closures every render.
 */
export function useStorySettingsSection({
  id,
  tab,
  dirtyFields,
  getPatch,
  reset,
}: SectionRegistration): void {
  const registry = useContext(SectionRegistryContext)
  if (registry == null) {
    throw new Error('useStorySettingsSection must be used inside StorySettingsSaveSessionProvider')
  }
  const { publish, unpublish, attach } = registry

  const callbacksRef = useRef<SectionCallbacks>({ getPatch, reset })
  callbacksRef.current = { getPatch, reset }

  useEffect(() => attach(id, callbacksRef), [attach, id])

  // A fresh array literal every render would re-fire this effect forever, so the
  // effect keys on a serialized form while publishing the real array. No
  // round-trip: upsertSection already does the per-field comparison.
  const fieldsRef = useRef(dirtyFields)
  fieldsRef.current = dirtyFields
  const dirtyKey = JSON.stringify(dirtyFields)
  useEffect(() => {
    publish({ id, tab, dirtyFields: fieldsRef.current })
  }, [publish, id, tab, dirtyKey])

  useEffect(() => () => unpublish(id), [unpublish, id])
}

export type { SaveSessionApi, SectionRegistration }
