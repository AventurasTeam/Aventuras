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

import {
  StorySettingsStaleStoreError,
  StorySettingsUnreadableError,
  type StorySettingsSessionPatch,
} from '@/lib/actions'
import type { StoryInfoPatch, StorySettings } from '@/lib/db'
import { logger } from '@/lib/diagnostics'

import {
  cloneDraft,
  computeSnapshot,
  removeSection,
  sameDraft,
  upsertSection,
  type FlaggedField,
  type SaveSessionSnapshot,
  type SectionDirtyState,
} from './save-session-state'
import { type StorySettingsTabId } from './tabs'

// Node (vitest) leaves __DEV__ undefined, so the check runs there too.
const DEV_CHECKS = typeof __DEV__ === 'undefined' || __DEV__

type SectionCallbacks = {
  getPatch: () => Partial<StorySettings>
  getColumnPatch?: () => StoryInfoPatch
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
  /** A flagged field is dirty on a story with turns; the confirmation dialog owns the next step. */
  | { status: 'confirm' }
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
   * The definitional-change confirmation is up: a save parked behind it, then
   * the commit it confirmed, until that commit settles.
   */
  confirming: boolean
  /**
   * Leave intents waiting on the session, oldest first. A list, not one slot:
   * a window close and a back-navigation can both be outstanding, and dropping
   * the earlier one strands whoever queued it — the main process keeps holding
   * a close nobody will ever confirm.
   */
  intents: readonly (() => void)[]
}

const EMPTY_STATE: SessionState = {
  sections: [],
  committing: false,
  confirming: false,
  intents: [],
}

type SaveSessionApi = {
  snapshot: SaveSessionSnapshot
  saving: boolean
  save: () => Promise<SaveOutcome>
  discard: () => void
  requestLeave: (proceed: () => void) => void
  pendingLeave: boolean
  resolveLeave: (outcome: 'save' | 'discard' | 'cancel') => void
  pendingConfirmation: boolean
  resolveConfirmation: (outcome: 'save' | 'cancel') => void
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

/** `devChecks` is an injectable seam: production takes the logging branch, never the throw. */
export function reportKeyCollision(
  owners: Map<string, string>,
  id: string,
  patch: Record<string, unknown>,
  devChecks: boolean = DEV_CHECKS,
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
    if (devChecks) throw new Error(message)
    logger.error('action_layer.story_settings_key_collision', { owner, sectionId: id, key })
  }
}

type SectionDraft = { settings: Partial<StorySettings>; columns: StoryInfoPatch }

function readDraft(entry: SectionCallbacks): SectionDraft {
  return { settings: entry.getPatch(), columns: entry.getColumnPatch?.() ?? {} }
}

type ProviderProps = {
  /**
   * Commits every dirty section's merged patch as ONE write. Called at most once
   * per save, never with an empty patch; a key is absent when no section set it.
   */
  onCommit: (patch: StorySettingsSessionPatch) => Promise<unknown>
  onSaved?: () => void
  onSaveFailed?: (error: unknown) => void
  /**
   * Whether a dirty flagged field needs confirming before the commit. Fails closed:
   * true unless `storyHasTurns` reported none, so a pending or failed read keeps asking.
   */
  confirmFlagged: boolean
  children: ReactNode
}

export function StorySettingsSaveSessionProvider({
  onCommit,
  onSaved,
  onSaveFailed,
  confirmFlagged,
  children,
}: ProviderProps) {
  const [state, setState] = useState<SessionState>(EMPTY_STATE)

  // Rendered state lands a tick late, so every synchronous guard reads this
  // instead — Cmd-S can race the leave guard's own save. Writing both through
  // `update` is what keeps the two from disagreeing.
  const stateRef = useRef(state)
  const confirmFlaggedRef = useRef(confirmFlagged)
  confirmFlaggedRef.current = confirmFlagged

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

  // `confirmed` is the user's consent; only `resolveConfirmation` passes true.
  const commit = useCallback(
    async (confirmed: boolean): Promise<SaveOutcome> => {
      if (stateRef.current.committing) return { status: 'busy' }
      // A parked session moves only through resolveConfirmation or discard.
      if (!confirmed && stateRef.current.confirming) return { status: 'confirm' }

      // Clean sections are skipped rather than trusted to return `{}`: every panel
      // stays mounted, so an unconditional getPatch would write a never-visited tab's
      // mount-time values over whatever changed them since.
      const dirty = dirtyIds(stateRef.current.sections)
      // Nothing to write. A leave waiting on this is already satisfied — the
      // session is clean — so proceed rather than stranding it.
      if (dirty.size === 0) {
        settleIntents()
        return { status: 'noop' }
      }

      // Refused, not failed: nothing was attempted, so a waiting leave stays queued rather
      // than settled or dropped — Discard and Cancel remain, and Save re-arms once valid.
      const current = computeSnapshot(stateRef.current.sections)
      if (current.invalidReason != null) {
        // The section id, not the reason: the reason is translated UI copy, so it
        // changes meaning per locale and never names which section refused.
        logger.warn('action_layer.story_settings_save_blocked', {
          sectionId: current.invalidSectionId,
        })
        return { status: 'invalid', reason: current.invalidReason }
      }

      // Parked, not refused: the dialog re-enters through resolveConfirmation,
      // and a leave waiting on this save keeps waiting with it.
      if (confirmFlaggedRef.current && !confirmed && current.flaggedFields.length > 0) {
        update((prev) => ({ ...prev, confirming: true }))
        return { status: 'confirm' }
      }

      // What each section's draft looked like when its patch was read, so an
      // edit made while the write was in flight isn't re-derived away after it.
      const committed = new Map<string, unknown>()

      update((prev) => ({ ...prev, committing: true }))
      try {
        // One merged write, not a commit per section: `stories` carries no delta, so a
        // mid-way failure across N writes would strand earlier sections with no undo.
        let settings: Partial<StorySettings> = {}
        let columns: StoryInfoPatch = {}
        const settingsOwners = new Map<string, string>()
        const columnOwners = new Map<string, string>()
        for (const [id, entry] of callbacksRef.current.entries()) {
          if (!dirty.has(id)) continue
          let draft: SectionDraft
          try {
            draft = readDraft(entry.current)
          } catch (error) {
            // Name the offender: otherwise a section's serialization bug is
            // indistinguishable from a DB failure.
            throw new Error(`Story Settings section "${id}" failed to build its patch`, {
              cause: error,
            })
          }
          reportKeyCollision(settingsOwners, id, draft.settings)
          reportKeyCollision(columnOwners, id, draft.columns)
          committed.set(id, cloneDraft(draft))
          settings = { ...settings, ...draft.settings }
          columns = { ...columns, ...draft.columns }
        }
        const merged: StorySettingsSessionPatch = {
          ...(Object.keys(settings).length > 0 ? { settings } : {}),
          ...(Object.keys(columns).length > 0 ? { columns } : {}),
        }
        await onCommit(merged)
      } catch (error) {
        try {
          onSaveFailed?.(error)
        } catch (handlerError) {
          // Isolated so commit never rejects: every caller fires it with `void`.
          logger.error('action_layer.story_settings_save_failed_handler_failed', {
            error: errorMessage(handlerError),
            saveError: errorMessage(error),
          })
        }
        // The write landed and only the store re-read failed, so this is not a save failure.
        // Sections keep their drafts — a reset would re-derive them from a store still holding
        // pre-save values — but the data is on disk, so a waiting leave must not be refused.
        if (error instanceof StorySettingsStaleStoreError) {
          settleIntents()
          return { status: 'committed', stillDirty: true, storeStale: true }
        }
        // Also on disk, and the store is current — the blob just no longer parses, so
        // the surface drops to its corrupt state and there is nothing left to re-save.
        if (error instanceof StorySettingsUnreadableError) {
          settleIntents()
          return { status: 'committed', stillDirty: false, storeStale: false }
        }
        return { status: 'rejected', error }
      } finally {
        update((prev) => ({ ...prev, committing: false }))
      }

      // Past the commit — the write is on disk, so nothing below may report a save failure,
      // and each step is isolated so one failure can't strand the rest. A section that didn't
      // move re-derives from the now-updated store, landing clean with no save baseline.
      const persisted = new Set<string>()
      for (const [id, entry] of callbacksRef.current.entries()) {
        if (!committed.has(id)) continue
        try {
          if (sameDraft(readDraft(entry.current), committed.get(id))) persisted.add(id)
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
      // Any save satisfies a waiting leave, not just the one the guard started — the back
      // arrow stays live during a commit. Only once the session is actually clean, though:
      // an edit that landed mid-write is still unsaved, and proceeding would drop it.
      const stillDirty = [...dirtyIds(stateRef.current.sections)].some((id) => !persisted.has(id))
      if (!stillDirty) settleIntents()
      return { status: 'committed', stillDirty, storeStale: false }
    },
    [onCommit, onSaved, onSaveFailed, resetSections, settleIntents, update],
  )

  const save = useCallback(() => commit(false), [commit])

  const discard = useCallback(() => {
    // A commit in flight owns the outcome, same as `resolveLeave`: the write
    // lands regardless, so reverting the drafts here would leave the session
    // clean and showing the values the user just asked to throw away.
    if (stateRef.current.committing) {
      logger.warn('action_layer.story_settings_discard_ignored', {})
      return
    }
    resetSections()
    // A parked save has nothing left to confirm once its drafts are gone.
    update((prev) => (prev.confirming ? { ...prev, confirming: false } : prev))
  }, [resetSections, update])

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

  const resolveConfirmation = useCallback(
    (outcome: 'save' | 'cancel') => {
      if (!stateRef.current.confirming) return
      // The confirmed commit owns the outcome, same as `resolveLeave`.
      if (stateRef.current.committing) {
        logger.warn('action_layer.story_settings_confirmation_ignored', { outcome })
        return
      }
      if (outcome === 'cancel') {
        // Back to the editor: the user did not consent, so a leave that was
        // waiting on this save must not fire later either.
        update((prev) => ({ ...prev, confirming: false, intents: [] }))
        return
      }
      // Held until the commit settles, however it ends: the dialog shows its
      // saving state, and a queued leave's dialog can't open over the write.
      void commit(true).finally(() =>
        update((prev) => (prev.confirming ? { ...prev, confirming: false } : prev)),
      )
    },
    [commit, update],
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
      pendingConfirmation: state.confirming,
      resolveConfirmation,
    }),
    [
      snapshot,
      state.committing,
      state.confirming,
      state.intents,
      save,
      discard,
      requestLeave,
      resolveLeave,
      resolveConfirmation,
    ],
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
   * This section's contribution to the surface's single save. Called only during a
   * save, so it may close over draft state freely, but **twice** — once to build the
   * write, once after it lands to check whether the draft moved in flight — so keep it
   * free of side effects. Never called while clean: return the whole slice always.
   *
   * Sections must own disjoint **top-level** `StorySettings` keys. Every value is
   * replaced wholesale, nested objects and arrays included, so two sections splitting
   * one key clobber each other; a collision refuses the save in dev and logs in prod.
   */
  getPatch: () => Partial<StorySettings>
  /**
   * This section's `stories` column patch, written in the same transaction as the
   * settings keys. Same contract as `getPatch`, except it may carry only the changed
   * columns — then diff against the section's own baseline, never the live row: the
   * second call runs after the store refresh, where a live-row diff comes back empty
   * and the section's reset is skipped. Omit when the section edits no columns.
   */
  getColumnPatch?: () => StoryInfoPatch
  /**
   * Non-null while this section is dirty but cannot be written — a
   * user-facing reason (e.g. "Two categories share a label"). The provider
   * refuses the save; the surface renders this beside the dirty-field list.
   * Ignored while the section is clean, since a clean section is never merged.
   */
  invalidReason?: string
  /**
   * The definitional fields among this section's dirty ones. When the story
   * has turns, a save listing any raises the confirmation modal first.
   */
  flaggedFields?: readonly FlaggedField[]
  /**
   * Drop this section's local draft so it re-derives from the `settings` the surface
   * passes down. Fires on Discard, and after a save for each section whose draft still
   * matches what that save wrote — one the user kept editing mid-commit stays dirty.
   *
   * Reading the `settings` prop here is correct: `saveStorySettingsSession` refreshes
   * `storiesStore` inside the awaited commit and React flushes that re-render first, so
   * the closure held here is already the post-save one. That is why the callback ref
   * below is written during render — an effect would leave this reading pre-save values.
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
  getColumnPatch,
  invalidReason,
  flaggedFields,
  reset,
}: SectionRegistration): void {
  const registry = useContext(SectionRegistryContext)
  if (registry == null) {
    throw new Error('useStorySettingsSection must be used inside StorySettingsSaveSessionProvider')
  }
  const { publish, unpublish, attach } = registry

  const callbacksRef = useRef<SectionCallbacks>({ getPatch, getColumnPatch, reset })
  callbacksRef.current = { getPatch, getColumnPatch, reset }

  useEffect(() => attach(id, callbacksRef), [attach, id])

  // A fresh array literal every render would re-fire this effect forever, so the
  // effect keys on a serialized form while publishing the real array. No
  // round-trip: upsertSection already does the per-field comparison.
  const fieldsRef = useRef(dirtyFields)
  fieldsRef.current = dirtyFields
  const flaggedRef = useRef(flaggedFields)
  flaggedRef.current = flaggedFields
  const dirtyKey = JSON.stringify(dirtyFields)
  const flaggedKey = JSON.stringify(flaggedFields ?? [])
  useEffect(() => {
    // Empty string still satisfies `!= null`, so publishing it verbatim would
    // refuse every save with a blank reason and leave Discard the only exit.
    // The throw is compiled out of the builds users run, hence also the coerce.
    if (DEV_CHECKS && invalidReason === '') {
      throw new Error(`Story Settings section "${id}" published an empty invalidReason.`)
    }
    publish({
      id,
      tab,
      dirtyFields: fieldsRef.current,
      invalidReason: invalidReason || undefined,
      flaggedFields: flaggedRef.current,
    })
  }, [publish, id, tab, dirtyKey, flaggedKey, invalidReason])

  useEffect(() => () => unpublish(id), [unpublish, id])
}

export type { SaveOutcome, SaveSessionApi, SectionRegistration }
