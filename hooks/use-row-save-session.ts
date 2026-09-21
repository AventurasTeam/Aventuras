import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form'

import { logger } from '@/lib/diagnostics'

export type RowCommitResult = { status: 'ok' } | { status: 'rejected'; reason: string }

export type RowSaveOutcome =
  /** Nothing to write; a leave waiting on the session was released. */
  | { status: 'noop' }
  | { status: 'busy' }
  /** The draft cannot be written; nothing was attempted. */
  | { status: 'invalid'; reason: string }
  /** The write landed. The session may still be dirty with an edit typed while it ran. */
  | { status: 'committed' }
  | { status: 'rejected'; reason: string }

export type RowSaveSessionOptions<Draft extends FieldValues> = {
  /** Identity of the row under edit (`create:<kind>` in create mode); a change resets the form. */
  rowKey: string
  /**
   * The committed values, which Discard restores. A same-row change refreshes every untouched
   * field and keeps the touched ones. Memoize on the row: identity is the fast path, and a
   * fresh but equal object is only deep-compared, never re-applied.
   */
  values: Draft
  resolver: Resolver<Draft>
  /** Top-level field name → the user-recognizable label the save bar lists. */
  fieldLabel: (field: string) => string
  /** A validation issue message (a key) → its translated text for the bar's notice. */
  issueText: (message: string) => string
  /**
   * Writes the draft as one delta action group. Expected refusals resolve `rejected` with a
   * translated reason; a throw is logged and surfaced the same way.
   */
  commit: (draft: Draft) => Promise<RowCommitResult>
}

export type RowSaveSession<Draft extends FieldValues> = {
  form: UseFormReturn<Draft>
  dirty: boolean
  /** Labels of the dirty top-level fields, in draft order. */
  dirtyFields: readonly string[]
  /** The first validation issue, translated; null while the draft is writable. */
  invalidReason: string | null
  saving: boolean
  /** The last commit rejection; cleared by the next save, a discard, or a row switch. */
  saveError: string | null
  save: () => Promise<RowSaveOutcome>
  discard: () => void
  /** Runs `proceed` now while clean; otherwise queues it behind Save / Discard / Cancel. */
  requestLeave: (proceed: () => void) => void
  pendingLeave: boolean
  resolveLeave: (outcome: 'save' | 'discard' | 'cancel') => void
}

/** What a surface needs from a pane's session to route its transitions (row switch, `←`, GO TO). */
export type RowSessionHandle = { dirty: boolean; requestLeave: (proceed: () => void) => void }

type Attempt = { outcome: RowSaveOutcome; clean: boolean }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// react-hook-form writes nested fields in place, so a committed draft must not share them.
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValue(v)])) as T
  }
  return value
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    )
  }
  return false
}

// react-hook-form marks nested fields as objects/arrays of booleans.
function hasDirty(value: unknown): boolean {
  if (value === true) return true
  if (Array.isArray(value)) return value.some(hasDirty)
  if (value != null && typeof value === 'object') return Object.values(value).some(hasDirty)
  return false
}

/** Depth-first: the first message in a (possibly nested) errors tree. */
function firstIssue(node: object): string | null {
  for (const value of Object.values(node)) {
    if (value == null || typeof value !== 'object') continue
    // A leaf error; its `ref` is the input element, whose React internals are cyclic.
    if ('type' in value && typeof value.type === 'string') {
      if ('message' in value && typeof value.message === 'string' && value.message !== '') {
        return value.message
      }
      continue
    }
    const nested = firstIssue(value)
    if (nested != null) return nested
  }
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The per-row save session (save-sessions.md): one form per selected row, explicit Save and
 * Discard, and a leave queue the surface routes every in-surface transition through. Not the
 * Story Settings session — that one aggregates sections into a single settings write.
 */
export function useRowSaveSession<Draft extends FieldValues>({
  rowKey,
  values,
  resolver,
  fieldLabel,
  issueText,
  commit,
}: RowSaveSessionOptions<Draft>): RowSaveSession<Draft> {
  // react-hook-form mutates formState in place; compiled memos keyed on it would go stale.
  'use no memo'
  const form = useForm<Draft>({
    defaultValues: values as DefaultValues<Draft>,
    resolver,
    mode: 'onChange',
  })
  // Read in render so the formState proxy subscribes. Dirty derives from `dirtyFields`, not
  // `isDirty`: a keepDirtyValues reset reports `isDirty: false` for a render with a draft held.
  const { dirtyFields: dirtyMap, errors } = form.formState

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pendingLeave, setPendingLeave] = useState(false)
  // Synchronous mirrors: Cmd-S can race the leave dialog's own save within one tick.
  const busyRef = useRef(false)
  // Oldest first: a window close and a back can both be outstanding.
  const intentsRef = useRef<(() => void)[]>([])
  const appliedRef = useRef({ rowKey, values })

  // Layout, not passive: the new row must never paint with the previous row's draft.
  useLayoutEffect(() => {
    const applied = appliedRef.current
    appliedRef.current = { rowKey, values }
    if (applied.rowKey !== rowKey) {
      setSaveError(null)
      form.reset(values)
      return
    }
    if (sameValue(applied.values, values)) return
    // A store patch to this row (a classifier pass, an undo) refreshes every untouched field —
    // else a later save writes the stale value back. Errors survive, re-checked against the
    // refreshed values, so an invalid draft never looks writable.
    const errored = Object.keys(form.formState.errors) as Path<Draft>[]
    form.reset(values, { keepDirtyValues: true, keepErrors: true })
    if (errored.length > 0) void form.trigger(errored)
  }, [rowKey, values, form])

  const settleIntents = useCallback(() => {
    const queued = intentsRef.current
    if (queued.length === 0) return
    // Cleared first so an intent that unmounts the surface can't see itself still queued.
    intentsRef.current = []
    setPendingLeave(false)
    for (const proceed of queued) {
      try {
        proceed()
      } catch (error) {
        logger.error('app.row_save_leave_failed', { error: errorMessage(error) })
      }
    }
  }, [])

  const clearIntents = useCallback(() => {
    intentsRef.current = []
    setPendingLeave(false)
  }, [])

  const attempt = useCallback(async (): Promise<Attempt> => {
    if (!(await form.trigger())) {
      // The render snapshot predates this trigger, so read the errors off the form itself.
      const tree = Object.fromEntries(
        Object.keys(form.getValues()).map((name) => [
          name,
          form.getFieldState(name as Path<Draft>).error,
        ]),
      )
      const issue = firstIssue(tree)
      return {
        outcome: { status: 'invalid', reason: issue == null ? '' : issueText(issue) },
        clean: false,
      }
    }
    setSaving(true)
    setSaveError(null)
    const key = appliedRef.current.rowKey
    const draft = cloneValue(form.getValues())
    let result: RowCommitResult
    try {
      result = await commit(draft)
    } catch (error) {
      const reason = errorMessage(error)
      logger.error('app.row_save_commit_failed', { error: reason })
      result = { status: 'rejected', reason }
    }
    if (result.status === 'rejected') {
      setSaveError(result.reason)
      return { outcome: result, clean: false }
    }
    // A row switch while the write ran already reset the form to the new row.
    if (appliedRef.current.rowKey !== key) return { outcome: { status: 'committed' }, clean: true }
    const current = form.getValues()
    form.reset(draft)
    if (sameValue(current, draft)) return { outcome: { status: 'committed' }, clean: true }
    // Typed while the write ran: keep it, dirty against what was just saved.
    form.reset(current, { keepDefaultValues: true, keepErrors: true })
    return { outcome: { status: 'committed' }, clean: false }
  }, [form, commit, issueText])

  const save = useCallback(async (): Promise<RowSaveOutcome> => {
    if (busyRef.current) return { status: 'busy' }
    if (!hasDirty(form.formState.dirtyFields)) {
      // Nothing to write, so a leave waiting on this save is already satisfied.
      settleIntents()
      return { status: 'noop' }
    }
    busyRef.current = true
    let result: Attempt
    try {
      result = await attempt()
    } finally {
      busyRef.current = false
      setSaving(false)
    }
    // A leave waits for a clean session, not just a landed write.
    if (result.clean) settleIntents()
    return result.outcome
  }, [form, attempt, settleIntents])

  const discard = useCallback(() => {
    // A commit in flight owns the outcome; the bar's disabled buttons are presentation.
    if (busyRef.current) return
    setSaveError(null)
    form.reset(values)
  }, [form, values])

  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (!hasDirty(form.formState.dirtyFields)) {
        proceed()
        return
      }
      intentsRef.current = [...intentsRef.current, proceed]
      setPendingLeave(true)
    },
    [form],
  )

  const resolveLeave = useCallback(
    (outcome: 'save' | 'discard' | 'cancel') => {
      if (busyRef.current) return
      // Cancel drops every queued leave: the user asked to stay, so none may navigate later.
      if (intentsRef.current.length === 0 || outcome === 'cancel') {
        clearIntents()
        return
      }
      if (outcome === 'discard') {
        discard()
        settleIntents()
        return
      }
      // save() drains the queue once the session is clean; a rejection keeps the three choices.
      void save()
    },
    [clearIntents, discard, save, settleIntents],
  )

  const dirtyByField: Record<string, unknown> = dirtyMap
  // Draft order first; a field the committed values omit still counts once dirtied.
  const dirtyFields = [...new Set([...Object.keys(values), ...Object.keys(dirtyByField)])]
    .filter((field) => hasDirty(dirtyByField[field]))
    .map((field) => fieldLabel(field))
  const issue = firstIssue(errors)

  return {
    form,
    dirty: dirtyFields.length > 0,
    dirtyFields,
    invalidReason: issue == null ? null : issueText(issue),
    saving,
    saveError,
    save,
    discard,
    requestLeave,
    pendingLeave,
    resolveLeave,
  }
}
