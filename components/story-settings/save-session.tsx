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
  cloneDraft,
  computeSnapshot,
  removeSection,
  sameDraft,
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

/**
 * What a save did. `committed` means the write is on disk — `storeStale` only
 * says the re-read afterwards failed, and `stillDirty` that an edit landed
 * while the write was in flight, so neither contradicts it.
 */
type SaveOutcome =
  | { status: 'noop' }
  | { status: 'busy' }
  /** A dirty section's draft cannot be written. Nothing was attempted. */
  | { status: 'invalid'; reason: string }
  | { status: 'committed'; stillDirty: boolean; storeStale: boolean }
  | { status: 'rejected'; error: unknown }

/**
 * The session's whole mutable state. One object so the synchronous mirror
 * below can't drift from what's rendered: `saving` and `pendingLeave` are
 * projections of this, never separate cells that need keeping in step.
 */
type SessionState = {
  sections: readonly SectionDirtyState[]
  committing: boolean
  /**
   * Leave intents waiting on the session, oldest first. A list, not one slot:
   * a window close and a back-navigation can both be outstanding, and dropping
   * the earlier one strands whoever queued it — the main process keeps holding
   * a close nobody will ever confirm.
   */
  intents: readonly (() => void)[]
}

const EMPTY_STATE: SessionState = { sections: [], committing: false, intents: [] }

type SaveSessionApi = {
  snapshot: SaveSessionSnapshot
  saving: boolean
  save: () => Promise<SaveOutcome>
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
  const [state, setState] = useState<SessionState>(EMPTY_STATE)

  // Rendered state lands a tick late, so every synchronous guard reads this
  // instead — Cmd-S can race the leave guard's own save. Writing both through
  // `update` is what keeps the two from disagreeing.
  const stateRef = useRef(state)

  const update = useCallback((fn: (prev: SessionState) => SessionState) => {
    const next = fn(stateRef.current)
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])

  // Callbacks live in refs, never in state: sections hand us fresh closures on
  // every render and storing them would re-render the whole surface each time.
  const callbacksRef = useRef(new Map<string, { current: SectionCallbacks }>())

  const publish = useCallback(
    (section: SectionDirtyState) => {
      update((prev) => {
        const sections = upsertSection(prev.sections, section)
        return sections === prev.sections ? prev : { ...prev, sections }
      })
    },
    [update],
  )

  const unpublish = useCallback(
    (id: string) => {
      update((prev) => {
        const sections = removeSection(prev.sections, id)
        return sections === prev.sections ? prev : { ...prev, sections }
      })
    },
    [update],
  )

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

  const snapshot = useMemo(() => computeSnapshot(state.sections), [state.sections])

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

  // Drains every waiting intent. Cleared before running them so an intent that
  // navigates and unmounts the surface can't see itself still queued.
  const settleIntents = useCallback(() => {
    const intents = stateRef.current.intents
    if (intents.length === 0) return
    update((prev) => ({ ...prev, intents: [] }))
    for (const proceed of intents) {
      try {
        proceed()
      } catch (error) {
        // Isolated: one intent failing must not strand the rest.
        logger.error('action_layer.story_settings_leave_failed', { error: errorMessage(error) })
      }
    }
  }, [update])

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (stateRef.current.committing) return { status: 'busy' }

    // Clean sections are skipped rather than trusted to return `{}`: every
    // panel stays mounted so a draft survives a tab switch, so an
    // unconditional getPatch would write a never-visited tab's mount-time
    // values over whatever changed them since.
    const dirty = dirtyIds(stateRef.current.sections)
    // Nothing to write. A leave waiting on this is already satisfied — the
    // session is clean — so proceed rather than stranding it.
    if (dirty.size === 0) {
      settleIntents()
      return { status: 'noop' }
    }

    // Refused, not failed: nothing was attempted, so a waiting leave stays
    // queued rather than being settled or dropped — the user still has Discard
    // and Cancel, and Save re-arms the moment the section reports itself valid.
    const invalidReason = computeSnapshot(stateRef.current.sections).invalidReason
    if (invalidReason != null) {
      logger.warn('action_layer.story_settings_save_blocked', { reason: invalidReason })
      return { status: 'invalid', reason: invalidReason }
    }

    // What each section's draft looked like when its patch was read, so an
    // edit made while the write was in flight isn't re-derived away after it.
    const committed = new Map<string, unknown>()

    update((prev) => ({ ...prev, committing: true }))
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
        committed.set(id, cloneDraft(patch))
        merged = { ...merged, ...patch }
      }
      await onCommit(merged)
    } catch (error) {
      onSaveFailed?.(error)
      // The write landed and only the store re-read failed, so this is not a
      // save failure. Sections keep their drafts — resetting would re-derive
      // them from a store still holding pre-save values — but the data is on
      // disk, so a leave waiting on this save must not be refused.
      if (error instanceof StorySettingsStaleStoreError) {
        settleIntents()
        return { status: 'committed', stillDirty: true, storeStale: true }
      }
      return { status: 'rejected', error }
    } finally {
      update((prev) => ({ ...prev, committing: false }))
    }

    // Past the commit — the write is on disk, so nothing below may report a
    // save failure, and each step is isolated so one failure can't strand the
    // rest. A section that didn't move re-derives its draft from the
    // now-updated store, so it lands clean without tracking a save baseline.
    const persisted = new Set<string>()
    for (const [id, entry] of callbacksRef.current.entries()) {
      if (!committed.has(id)) continue
      try {
        if (sameDraft(entry.current.getPatch(), committed.get(id))) persisted.add(id)
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
    const stillDirty = [...dirtyIds(stateRef.current.sections)].some((id) => !persisted.has(id))
    if (!stillDirty) settleIntents()
    return { status: 'committed', stillDirty, storeStale: false }
  }, [onCommit, onSaved, onSaveFailed, resetSections, settleIntents, update])

  const discard = useCallback(() => {
    // A commit in flight owns the outcome, same as `resolveLeave`: the write
    // lands regardless, so reverting the drafts here would leave the session
    // clean and showing the values the user just asked to throw away.
    if (stateRef.current.committing) {
      logger.warn('action_layer.story_settings_discard_ignored', {})
      return
    }
    resetSections()
  }, [resetSections])

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (dirtyIds(stateRef.current.sections).size === 0) {
        proceed()
        return
      }
      update((prev) => ({ ...prev, intents: [...prev.intents, proceed] }))
    },
    [update],
  )

  const resolveLeave = useCallback(
    (outcome: 'save' | 'discard' | 'cancel') => {
      // A commit in flight owns the outcome; the dialog's disabled buttons are
      // presentation, not enforcement.
      if (stateRef.current.committing) {
        logger.warn('action_layer.story_settings_leave_ignored', { outcome })
        return
      }
      if (stateRef.current.intents.length === 0 || outcome === 'cancel') {
        // Cancel drops every queued intent, not just the newest: the user asked
        // to stay, so nothing outstanding may quietly navigate later.
        update((prev) => (prev.intents.length === 0 ? prev : { ...prev, intents: [] }))
        return
      }
      if (outcome === 'discard') {
        discard()
        settleIntents()
        return
      }
      // The intents outlive the commit — save() drains them once the session is
      // actually clean — so the dialog can disable itself while the write runs.
      // A failure, or an edit that landed mid-write, leaves the user on the same
      // three choices rather than dropping the navigation they asked for.
      void save()
    },
    [discard, save, settleIntents, update],
  )

  const api = useMemo<SaveSessionApi>(
    () => ({
      snapshot,
      saving: state.committing,
      save,
      discard,
      requestLeave,
      pendingLeave: state.intents.length > 0,
      resolveLeave,
    }),
    [snapshot, state.committing, state.intents, save, discard, requestLeave, resolveLeave],
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
   * Non-null while this section is dirty but cannot be written — a
   * user-facing reason (e.g. "Two categories share a label"). The surface
   * refuses the save and renders this beside the dirty-field list. Ignored
   * while the section is clean, since a clean section is never merged.
   */
  invalidReason?: string
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
  invalidReason,
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
    publish({ id, tab, dirtyFields: fieldsRef.current, invalidReason })
  }, [publish, id, tab, dirtyKey, invalidReason])

  useEffect(() => () => unpublish(id), [unpublish, id])
}

export type { SaveOutcome, SaveSessionApi, SectionRegistration }
