import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type Ref,
  type RefObject,
} from 'react'
import type { View } from 'react-native'

import { db } from '@/lib/db'
import { branchesStore, refreshBranches, type BranchRow } from '@/lib/stores'

import {
  BranchNavigator,
  type BranchChipView,
  type BranchNavigatorHandle,
} from './branch-navigator'
import { useHeldChip } from './use-held-chip'

/**
 * Rows that lack the reader's branch (a refresh still landing after a fork) give no chip, so it
 * stays hidden rather than flashing.
 */
export function branchChipOf(rows: readonly BranchRow[], branchId: string): BranchChipView | null {
  const current = rows.find((row) => row.id === branchId)
  return current == null ? null : { count: rows.length, currentName: current.name }
}

export type ReaderBranchNavigatorHandle = { open: () => void }

export type ReaderBranchNavigatorProps = {
  storyId: string
  branchId: string
  isFocused: boolean
  /** The generation gate less any restart hold, a dispatch in flight, or the reader hold. */
  paused: boolean
  onSwitch: (branchId: string) => void
  onRename: (branchId: string, name: string) => Promise<unknown>
  /** Absent: no row shows a delete control. */
  onDelete?: (branchId: string) => void
  /** While a confirm sits above the navigator, an outside focus or press doesn't close it. */
  holdOpen?: boolean
  currentRowRef?: RefObject<View | null>
  ref?: Ref<ReaderBranchNavigatorHandle>
}

export function ReaderBranchNavigator({
  storyId,
  branchId,
  isFocused,
  paused,
  onSwitch,
  onRename,
  onDelete,
  holdOpen,
  currentRowRef,
  ref,
}: ReaderBranchNavigatorProps): ReactElement {
  const rows = branchesStore.useBranches(storyId, (held) => held)
  const liveChip = useMemo(() => branchChipOf(rows, branchId), [rows, branchId])
  const [open, setOpen] = useState(false)
  // branch-navigator.md → Delete confirm: the header's count drops at once, the chip's at close.
  // On desktop the chip is the open Popover's anchor, so it can't swap out under it.
  const chip = useHeldChip(liveChip, open)

  // A reader mounts fresh per branch, so this is the read after a switch's or a fork's navigation.
  useEffect(() => {
    void refreshBranches(db, storyId)
  }, [storyId])

  const navigatorRef = useRef<BranchNavigatorHandle>(null)
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        // A held open (phone, after the Actions Sheet's exit) can land after a push took focus.
        if (!isFocused) return
        // A failed read leaves the rows without this branch, and nothing else reads them again.
        if (!branchesStore.getBranches(storyId).some((row) => row.id === branchId)) {
          void refreshBranches(db, storyId)
        }
        navigatorRef.current?.open()
      },
    }),
    [isFocused, storyId, branchId],
  )
  // A portaled overlay would keep painting over the screen pushed on top of this one.
  useEffect(() => {
    if (!isFocused) navigatorRef.current?.close()
  }, [isFocused])

  return (
    <BranchNavigator
      ref={navigatorRef}
      rows={rows}
      currentBranchId={branchId}
      chip={chip}
      paused={paused}
      onSwitch={onSwitch}
      onRename={onRename}
      onDelete={onDelete}
      onOpenChange={setOpen}
      holdOpen={holdOpen}
      currentRowRef={currentRowRef}
    />
  )
}
