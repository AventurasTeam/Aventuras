import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { ImportRejectionCode, ImportRowResult } from '@/lib/actions'

export type UseRowImportArgs<P> = {
  /** `isUserEditBlocked`: the request is refused and an open dialog closes. */
  blocked: boolean
  /** Screen focus; unfocused acts as `blocked` (a portaled dialog would paint over a pushed screen). */
  focused: boolean
  /** The surface's leave guard; opening the dialog and selecting the new row both resolve it. */
  guard: (proceed: () => void) => void
  select: (id: string) => void
  commit: (payload: P) => Promise<ImportRowResult>
  /** After an ok commit, once the new row's select has gone to `guard`. */
  onImported: () => void
  onRejected: (code: ImportRejectionCode) => void
  onFailed: (error: unknown) => void
}

export type RowImport<P> = {
  open: boolean
  request: () => void
  onOpenChange: (open: boolean) => void
  onValidated: (payload: P) => void
}

/** import-dialog.md → Host gating during in-flight generation, for one `From JSON file…` dialog. */
export function useRowImport<P>({
  blocked,
  focused,
  guard,
  select,
  commit,
  onImported,
  onRejected,
  onFailed,
}: UseRowImportArgs<P>): RowImport<P> {
  const [open, setOpen] = useState(false)
  // The commit outlives the render that started it; its outcome goes to the latest callbacks.
  const callbacks = useRef({ guard, select, onImported, onRejected, onFailed })
  useLayoutEffect(() => {
    callbacks.current = { guard, select, onImported, onRejected, onFailed }
  }, [guard, select, onImported, onRejected, onFailed])
  const gated = blocked || !focused
  // In render, not an effect: the dialog never commits open while gated.
  if (gated && open) setOpen(false)

  const request = useCallback(() => {
    if (gated) return
    guard(() => setOpen(true))
  }, [gated, guard])

  const onOpenChange = useCallback(
    (next: boolean) => (next ? request() : setOpen(false)),
    [request],
  )

  const onValidated = useCallback(
    (payload: P) => {
      // Two-argument `then`: a throw inside `select` or `onImported` must not route to `onFailed`.
      Promise.resolve()
        .then(() => commit(payload))
        .then(
          (result) => {
            const current = callbacks.current
            if (result.status === 'ok') {
              current.guard(() => current.select(result.id))
              current.onImported()
            } else current.onRejected(result.code)
          },
          (error: unknown) => callbacks.current.onFailed(error),
        )
    },
    [commit],
  )

  return { open, request, onOpenChange, onValidated }
}
