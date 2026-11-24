import { useEffect, useImperativeHandle, useMemo, useRef, type ReactElement, type Ref } from 'react'

import { db } from '@/lib/db'
import { branchesStore, refreshBranches, type BranchRow } from '@/lib/stores'

import { BranchNavigator, type BranchNavigatorHandle } from './branch-navigator'

/**
 * The chip's two props, derived in one place. Rows that lack the reader's branch (a refresh still
 * landing after a fork) give no name and no count, so the chip stays hidden rather than flashing.
 */
export function branchChipOf(
  rows: readonly BranchRow[],
  branchId: string,
): { count: number; currentName: string | null } {
  const current = rows.find((row) => row.id === branchId)
  return current == null
    ? { count: 0, currentName: null }
    : { count: rows.length, currentName: current.name }
}

export type ReaderBranchNavigatorHandle = { open: () => void }

export type ReaderBranchNavigatorProps = {
  storyId: string
  branchId: string
  isFocused: boolean
  /** The gate without this branch's hold, the reader's dispatch, or the reader hold. */
  paused: boolean
  onSwitch: (branchId: string) => void
  onRename: (branchId: string, name: string) => Promise<unknown>
  ref?: Ref<ReaderBranchNavigatorHandle>
}

export function ReaderBranchNavigator({
  storyId,
  branchId,
  isFocused,
  paused,
  onSwitch,
  onRename,
  ref,
}: ReaderBranchNavigatorProps): ReactElement {
  const rows = branchesStore.useBranches(storyId, (held) => held)
  const chip = useMemo(() => branchChipOf(rows, branchId), [rows, branchId])

  // A reader mounts fresh per branch, so this is the read after a switch's or a fork's navigation.
  useEffect(() => {
    void refreshBranches(db, storyId)
  }, [storyId])

  const navigatorRef = useRef<BranchNavigatorHandle>(null)
  useImperativeHandle(ref, () => ({ open: () => navigatorRef.current?.open() }), [])
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
    />
  )
}
