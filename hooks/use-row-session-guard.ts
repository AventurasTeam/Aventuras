import { useCallback, useState } from 'react'

import type { RowSessionHandle } from './use-row-save-session'
import { useSurfaceNavigate } from './use-surface-navigate'
import { useUnsavedChangesGuard } from './use-unsaved-changes-guard'

type LeaveRequest = (proceed: () => void) => void

type RowSessionGuard = {
  onSession: (handle: RowSessionHandle | null) => void
  guard: LeaveRequest
  navigateGuarded: (path: string) => void
}

/** save-sessions.md → Navigate-away guard: every in-surface transition routes through `guard`. */
export function useRowSessionGuard(): RowSessionGuard {
  const surfaceNavigate = useSurfaceNavigate()
  const [session, setSession] = useState<RowSessionHandle | null>(null)
  const guard = useCallback(
    (proceed: () => void) => {
      if (session == null) proceed()
      else session.requestLeave(proceed)
    },
    [session],
  )
  useUnsavedChangesGuard(session?.dirty ?? false, guard)
  const navigateGuarded = useCallback(
    (path: string) => guard(() => surfaceNavigate(path)),
    [guard, surfaceNavigate],
  )
  return { onSession: setSession, guard, navigateGuarded }
}
