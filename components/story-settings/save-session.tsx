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

import {
  computeSnapshot,
  removeSection,
  upsertSection,
  type SaveSessionSnapshot,
  type SectionDirtyState,
} from './save-session-state'

// Node (vitest) leaves __DEV__ undefined, so the check runs there too.
const DEV_CHECKS = typeof __DEV__ === 'undefined' || __DEV__

type SectionCallbacks = {
  getPatch: () => Partial<StorySettings>
  reset: () => void
}

type SaveSessionApi = {
  snapshot: SaveSessionSnapshot
  saving: boolean
  publish: (state: SectionDirtyState) => void
  unpublish: (id: string) => void
  attach: (id: string, callbacks: { current: SectionCallbacks }) => () => void
  /**
   * Resolves `true` only when this call committed. `false` covers both a
   * rejected commit and a call turned away because one was already in flight —
   * in either case the outcome is unknown to the caller, so treat it as "do not
   * proceed".
   */
  save: () => Promise<boolean>
  discard: () => void
  requestLeave: (proceed: () => void) => void
  pendingLeave: boolean
  resolveLeave: (outcome: 'save' | 'discard' | 'cancel') => void
}

const SaveSessionContext = createContext<SaveSessionApi | null>(null)

function warnOnKeyCollision(
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
    // eslint-disable-next-line no-console -- __DEV__ wiring warning; must fire regardless of the diagnostics master gate, so the logger is the wrong channel.
    console.warn(
      `Story Settings sections "${owner}" and "${id}" both patch the top-level key "${key}". The merge is shallow, so one clobbers the other and the winner depends on mount order.`,
    )
  }
}

type ProviderProps = {
  /**
   * Commits the merged patch from every section as ONE write. The provider
   * never calls this more than once per save.
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
      map.delete(id)
    }
  }, [])

  const snapshot = useMemo(() => computeSnapshot(sections), [sections])

  const save = useCallback(async () => {
    if (savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    try {
      // One merged write, not a commit per section: `stories` carries no delta,
      // so a mid-way failure across N writes would strand earlier sections
      // persisted with no way to undo them.
      let merged: Partial<StorySettings> = {}
      const owners = DEV_CHECKS ? new Map<string, string>() : null
      for (const [id, entry] of callbacksRef.current.entries()) {
        const patch = entry.current.getPatch()
        if (owners) warnOnKeyCollision(owners, id, patch)
        merged = { ...merged, ...patch }
      }
      await onCommit(merged)
      // Sections re-derive their draft from the now-updated store, so the
      // session lands clean without each one tracking its own save baseline.
      for (const entry of callbacksRef.current.values()) entry.current.reset()
      onSaved?.()
      return true
    } catch (error) {
      onSaveFailed?.(error)
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [onCommit, onSaved, onSaveFailed])

  const discard = useCallback(() => {
    for (const entry of callbacksRef.current.values()) entry.current.reset()
  }, [])

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (!snapshot.isDirty) {
        proceed()
        return
      }
      setPendingLeave(() => proceed)
    },
    [snapshot.isDirty],
  )

  const resolveLeave = useCallback(
    (outcome: 'save' | 'discard' | 'cancel') => {
      const proceed = pendingLeave
      setPendingLeave(null)
      if (proceed == null || outcome === 'cancel') return
      if (outcome === 'discard') {
        discard()
        proceed()
        return
      }
      void save().then((ok) => {
        if (ok) proceed()
      })
    },
    [pendingLeave, discard, save],
  )

  const api = useMemo<SaveSessionApi>(
    () => ({
      snapshot,
      saving,
      publish,
      unpublish,
      attach,
      save,
      discard,
      requestLeave,
      pendingLeave: pendingLeave != null,
      resolveLeave,
    }),
    [
      snapshot,
      saving,
      publish,
      unpublish,
      attach,
      save,
      discard,
      requestLeave,
      pendingLeave,
      resolveLeave,
    ],
  )

  return <SaveSessionContext.Provider value={api}>{children}</SaveSessionContext.Provider>
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
  /** Rail order of the owning tab — drives save-bar label order. */
  order: number
  /** User-recognizable labels, e.g. `['suggestions', 'suggestion count']`. */
  dirtyFields: readonly string[]
  /**
   * This section's contribution to the surface's single save. Read only at
   * save time, so it may close over draft state freely. Return `{}` when clean.
   *
   * Sections must own disjoint **top-level** `StorySettings` keys. The merge is
   * shallow, so two sections contributing different parts of one nested object
   * (`translation`, `models`, `retrievalBudgets`, `packVariables`) clobber each
   * other, and the winner is decided by mount order. Dev builds warn on
   * collision.
   */
  getPatch: () => Partial<StorySettings>
  /** Re-derive the draft from persisted state. Fires on Discard AND after a successful save. */
  reset: () => void
}

/**
 * Joins a section to the surface's save session. Call from inside the section
 * component; it may be called with fresh arrays and closures every render.
 */
export function useStorySettingsSection({
  id,
  order,
  dirtyFields,
  getPatch,
  reset,
}: SectionRegistration): void {
  const { publish, unpublish, attach } = useStorySettingsSaveSession()

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
    publish({ id, order, dirtyFields: fieldsRef.current })
  }, [publish, id, order, dirtyKey])

  useEffect(() => () => unpublish(id), [unpublish, id])
}

export type { SaveSessionApi, SectionRegistration }
