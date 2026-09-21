import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  useForm,
  type DefaultValues,
  type FieldValues,
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
   * top-level field and keeps the touched ones. Memoize on the row: identity is the fast path,
   * and a fresh but equal object is only deep-compared, never re-applied.
   */
  values: Draft
  resolver: Resolver<Draft>
  /** Top-level field name → the user-recognizable label the save bar lists. */
  fieldLabel: (field: string) => string
  /** A validation issue message (a key) → its translated text for the bar's notice. */
  issueText: (message: string) => string
  /** Translated generic failure for a throw in validation or the commit; raw errors are logged. */
  failureText: () => string
  /**
   * Writes the draft as one delta action group. Receives the raw form values, not the resolver's
   * parsed output. Expected refusals resolve `rejected` with a translated reason.
   */
  commit: (draft: Draft) => Promise<RowCommitResult>
  /**
   * A save failed, with its translated reason — also when the form has since moved to another
   * row, which keeps no `saveError` for it. The bar's notice is tooltip-only on phone; toast this.
   */
  onRejected?: (reason: string) => void
}

export type RowSaveSession<Draft extends FieldValues> = {
  form: UseFormReturn<Draft>
  dirty: boolean
  /** Labels of the dirty top-level fields, in draft order. */
  dirtyFields: readonly string[]
  /** The first validation issue, translated; null while the draft is writable. */
  invalidReason: string | null
  /** From validation until the commit settles; Discard and leave choices are ignored meanwhile. */
  saving: boolean
  /** This row's last failed save; cleared as a retry starts writing, on discard, on row switch. */
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

type Written<Draft> =
  | { status: 'invalid'; reason: string }
  | { status: 'rejected'; reason: string }
  | { status: 'ok'; draft: Draft }

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
  failureText,
  commit,
  onRejected,
}: RowSaveSessionOptions<Draft>): RowSaveSession<Draft> {
  // react-hook-form mutates formState in place; compiled memos keyed on it would go stale.
  'use no memo'
  const form = useForm<Draft>({
    defaultValues: values as DefaultValues<Draft>,
    resolver,
    mode: 'onChange',
  })
  // Read in render so the formState proxy subscribes. `dirty` derives from `dirtyFields`, not
  // `isDirty`, so it can never disagree with the labels the bar lists.
  const { dirtyFields: dirtyMap, errors } = form.formState

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pendingLeave, setPendingLeave] = useState(false)
  // Callbacks decide on refs: state renders late, and Cmd-S can race the dialog's Save.
  const busyRef = useRef(false)
  // Oldest first: a window close and a back can both be outstanding.
  const intentsRef = useRef<(() => void)[]>([])
  const appliedRef = useRef({ rowKey, values })
  // The render snapshot trails a trigger() by a render; the subscription sees every emission.
  const errorsRef = useRef<object>(errors)

  // Passive, after react-hook-form's own mount effect: subscribing flags the form mounted.
  useEffect(
    () =>
      form.subscribe({
        formState: { errors: true },
        callback: (state) => {
          if (state.errors != null) errorsRef.current = state.errors
        },
      }),
    [form],
  )

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
    // A store patch to this row (a classifier pass, an undo) refreshes every untouched field, else
    // a later save writes the stale value back. Per top-level field: a path-wise merge grafts a
    // patch onto whichever array row shifted into its index.
    const current: Record<string, unknown> = form.getValues()
    const touched: Record<string, unknown> = form.formState.dirtyFields
    const merged: Record<string, unknown> = { ...values }
    for (const field of Object.keys(current)) {
      if (hasDirty(touched[field])) merged[field] = current[field]
    }
    const hadIssues = Object.keys(errorsRef.current).length > 0
    // Two resets rebase the draft on the refreshed row, so a patch matching the draft reads clean.
    form.reset(values, { keepErrors: true })
    form.reset(merged as Draft, { keepDefaultValues: true, keepErrors: true })
    // Re-checked against the refreshed values, so an invalid draft never looks writable.
    if (hadIssues) {
      void form.trigger().catch((error: unknown) => {
        logger.error('app.row_save_validate_failed', { error: errorMessage(error) })
      })
    }
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

  const reportRejection = useCallback(
    (reason: string) => {
      try {
        onRejected?.(reason)
      } catch (error) {
        logger.error('app.row_save_rejected_handler_failed', { error: errorMessage(error) })
      }
    },
    [onRejected],
  )

  const write = useCallback(async (): Promise<Written<Draft>> => {
    try {
      if (!(await form.trigger())) {
        const issue = firstIssue(errorsRef.current)
        return { status: 'invalid', reason: issue == null ? '' : issueText(issue) }
      }
      setSaveError(null)
      const draft = cloneValue(form.getValues())
      const result = await commit(draft)
      return result.status === 'ok' ? { status: 'ok', draft } : result
    } catch (error) {
      // Raw errors (SQLITE_BUSY, a resolver bug) are for the log, not the user.
      logger.error('app.row_save_failed', { error: errorMessage(error) })
      return { status: 'rejected', reason: failureText() }
    }
  }, [form, commit, issueText, failureText])

  // Clean at the saved values unless an edit was typed while the write ran; returns whether clean.
  const rebase = useCallback(
    (draft: Draft, valuesAtStart: Draft): boolean => {
      const stored = appliedRef.current.values
      // A store row that landed mid-commit is a truer baseline than the draft that was sent.
      const refreshed = !sameValue(stored, valuesAtStart)
      const baseline = refreshed ? stored : draft
      const current: Record<string, unknown> = form.getValues()
      const touched: Record<string, unknown> = form.formState.dirtyFields
      const sent: Record<string, unknown> = draft
      // Any move off the draft is a mid-commit edit, a revert to the original included; only after
      // a refresh must it also be touched, since the refresh moved the untouched fields itself.
      const typed = Object.keys(current).filter(
        (field) =>
          (!refreshed || hasDirty(touched[field])) && !sameValue(current[field], sent[field]),
      )
      form.reset(baseline, { keepErrors: typed.length > 0 })
      if (typed.length === 0) return true
      const kept = Object.fromEntries(typed.map((field) => [field, current[field]]))
      form.reset({ ...baseline, ...kept }, { keepDefaultValues: true, keepErrors: true })
      return false
    },
    [form],
  )

  const attempt = useCallback(async (): Promise<Attempt> => {
    const { rowKey: key, values: valuesAtStart } = appliedRef.current
    const written = await write()
    if (written.status === 'invalid') return { outcome: written, clean: false }
    if (written.status === 'rejected') reportRejection(written.reason)
    const outcome: RowSaveOutcome = written.status === 'ok' ? { status: 'committed' } : written
    // The form moved to another row mid-write: nothing here is that row's to carry, and a queued
    // leave waits only on an edit of its own (a clean session satisfies it, as a noop save does).
    if (appliedRef.current.rowKey !== key) {
      return { outcome, clean: !hasDirty(form.formState.dirtyFields) }
    }
    if (written.status === 'rejected') {
      setSaveError(written.reason)
      return { outcome, clean: false }
    }
    return { outcome, clean: rebase(written.draft, valuesAtStart) }
  }, [form, write, rebase, reportRejection])

  const save = useCallback(async (): Promise<RowSaveOutcome> => {
    if (busyRef.current) return { status: 'busy' }
    if (!hasDirty(form.formState.dirtyFields)) {
      // Nothing to write, so a leave waiting on this save is already satisfied.
      settleIntents()
      return { status: 'noop' }
    }
    busyRef.current = true
    setSaving(true)
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
    // A save in flight owns the outcome; the bar's disabled buttons are presentation.
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
