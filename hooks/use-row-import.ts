import { useCallback, useState } from 'react'

import type { ImportRowResult, RowSaveRejectionCode } from '@/lib/actions'

export type UseRowImportArgs<P> = {
  /** `isUserEditBlocked`: the request is refused and an open dialog closes. */
  blocked: boolean
  /** The surface's leave guard; a dirty draft resolves before the dialog opens. */
  guard: (proceed: () => void) => void
  commit: (payload: P) => Promise<ImportRowResult>
  onImported: (id: string) => void
  onRejected: (code: RowSaveRejectionCode) => void
  onFailed: (error: unknown) => void
}

export type RowImport<P> = {
  open: boolean
  request: () => void
  onOpenChange: (open: boolean) => void
  onValidated: (payload: P) => void
}

/**
 * import-dialog.md → Host gating during in-flight generation: one `From JSON file…` dialog's open
 * state, opened through the surface's leave guard, and the commit its validated payload runs.
 */
export function useRowImport<P>({
  blocked,
  guard,
  commit,
  onImported,
  onRejected,
  onFailed,
}: UseRowImportArgs<P>): RowImport<P> {
  const [open, setOpen] = useState(false)
  // In render, not an effect: the dialog never commits open while blocked.
  if (blocked && open) setOpen(false)

  const request = useCallback(() => {
    if (blocked) return
    guard(() => setOpen(true))
  }, [blocked, guard])

  const onValidated = useCallback(
    (payload: P) => {
      // Two-argument `then`: a throw inside `onImported` must not route to `onFailed`.
      Promise.resolve()
        .then(() => commit(payload))
        .then((result) => {
          if (result.status === 'ok') onImported(result.id)
          else onRejected(result.code)
        }, onFailed)
    },
    [commit, onImported, onRejected, onFailed],
  )

  return { open, request, onOpenChange: setOpen, onValidated }
}
