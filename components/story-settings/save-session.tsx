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
   * Resolves `true` when the session reached a clean, persisted state — the
   * commit landed, or there was nothing to commit. `false` means the write was
   * rejected, or a commit was already in flight and this call was turned away;
   * either way the caller must not proceed. A failure *after* the write lands
   * never reports `false` — it is logged, because the data is on disk.
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
    // Unrecoverable data loss (`stories` carries no delta), so it is logged in
    // every build, not just dev.
    logger.error('action_layer.story_settings_key_collision', { owner, sectionId: id, key })
    if (DEV_CHECKS) {
      // eslint-disable-next-line no-console -- __DEV__ wiring warning; must fire regardless of the diagnostics master gate, so the logger alone is the wrong channel.
      console.warn(message)
    }
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
    map.set(id, callbacks)
    return () => {
      // Identity-checked: two sections sharing an id would otherwise let the
      // first to unmount evict the survivor, leaving it dirty but invisible.
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
        merged = { ...merged, ...patch }
      }
      await onCommit(merged)
    } catch (error) {
      onSaveFailed?.(error)
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }

    // Past the commit — the write is on disk, so nothing below may report a
    // save failure, and each step is isolated so one failure can't strand the
    // rest. Sections re-derive their draft from the now-updated store, so the
    // session lands clean without each one tracking a save baseline.
    resetSections(dirty)
    try {
      onSaved?.()
    } catch (error) {
      logger.error('action_layer.story_settings_post_commit_failed', {
        error: errorMessage(error),
      })
    }
    // Any save satisfies a waiting leave, not just the one the guard started:
    // the back arrow stays live during a commit, so a leave can be requested
    // after it, and the session is clean now either way.
    settlePendingLeave()
    return true
  }, [onCommit, onSaved, onSaveFailed, resetSections, settlePendingLeave])

  const discard = useCallback(() => {
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
      // The guard outlives the commit — save() clears it and proceeds on
      // success — so it can disable itself while the write runs, and a failure
      // leaves the user on the same three choices rather than dropping the
      // navigation they asked for.
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
   * This section's contribution to the surface's single save. Read only at
   * save time, so it may close over draft state freely. The provider skips
   * sections whose `dirtyFields` is empty, so this never runs while clean —
   * return this section's whole slice, unconditionally.
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
   * that save committed.
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
