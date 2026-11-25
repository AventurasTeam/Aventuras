import { and, eq } from 'drizzle-orm'

import { branches, stories } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  chapterOverlaysStore,
  currentStoryStore,
  generationStore,
  isStoryBusy,
  isUserEditBlocked,
  navigationStore,
  readerHoldStore,
  rehydrateStories,
  storiesStore,
  type ReaderHoldToken,
} from '@/lib/stores'
import { messageOf } from '@/lib/thrown'

import type { DbCtx } from '../types'
import {
  afterBranchPublished,
  fillWorkingSet,
  readBranchWorkingSet,
  type BranchWorkingSet,
  type ReadBranchResult,
} from './operational'
import { runExclusiveSwitch } from './switch-in-flight'

export type SwitchBranchInput = {
  storyId: string
  /** The branch the reader shows: where a failure puts the pointer back. */
  fromBranchId: string
  toBranchId: string
  /** The reader hold the caller took; released on every path. */
  hold: ReaderHoldToken
  /** False once the reader that started it lost focus or unmounted. */
  isCurrentRequest: () => boolean
  /** One stack reset; true when it took (hooks/use-replace-story-stack.ts). */
  replaceStack: (branchId: string) => boolean
}

export type SwitchBranchResult =
  | { status: 'ok' }
  | { status: 'refused'; code: 'gate' | 'turn-body' | 'missing' | 'running' }
  | { status: 'failed'; code: 'load' | 'stories-reread' | 'navigation-blocked' }
  | { status: 'abandoned' }

type RefusalCode = Extract<SwitchBranchResult, { status: 'refused' }>['code']
type FailureCode = Extract<SwitchBranchResult, { status: 'failed' }>['code']
type FailureDetail = { error?: string; readStatus?: ReadBranchResult['status'] }
type BlockedCause = 'busy' | 'turn-body' | 'reset-refused'

/**
 * C8: writes the pointer, reads the branch and re-reads the stories, then in one synchronous block
 * resets the stack and, only once the reset took, fills and publishes. Never a story open.
 */
export async function switchBranch(
  input: SwitchBranchInput,
  ctx: DbCtx,
): Promise<SwitchBranchResult> {
  const result = await attemptSwitch(input, ctx)
  // Whatever stopped it, a switch whose reader has gone shows nothing: the user left.
  return result.status === 'ok' || input.isCurrentRequest() ? result : { status: 'abandoned' }
}

async function attemptSwitch(input: SwitchBranchInput, ctx: DbCtx): Promise<SwitchBranchResult> {
  // No branch: a branch held until a restart blocks neither leaving it nor entering it. Busy too:
  // a run that holds no gate would leave the story-leave guard swallowing the reset.
  const txState = generationStore.getTxState()
  if (isUserEditBlocked(txState) || isStoryBusy(txState, input.storyId, input.fromBranchId))
    return refuse(input, 'gate')
  // A failed regenerate's sweep can still be writing on the branch left with the gate open.
  if (generationStore.isTurnBodyActive(input.fromBranchId)) return refuse(input, 'turn-body')
  const run = await runExclusiveSwitch(async () => {
    try {
      return await moveAndShow(input, ctx)
    } finally {
      readerHoldStore.release(input.hold)
    }
  })
  return run.ran ? run.value : refuse(input, 'running')
}

function refuse(input: SwitchBranchInput, code: RefusalCode): SwitchBranchResult {
  readerHoldStore.release(input.hold)
  return { status: 'refused', code }
}

async function moveAndShow(input: SwitchBranchInput, ctx: DbCtx): Promise<SwitchBranchResult> {
  const { storyId, fromBranchId, toBranchId, isCurrentRequest } = input
  // The pointer has no foreign key: a write naming a missing or foreign branch would succeed.
  const [target] = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, toBranchId), eq(branches.storyId, storyId)))
  if (target == null) return { status: 'refused', code: 'missing' }
  if (!isCurrentRequest()) return { status: 'abandoned' }

  await writePointer(ctx, storyId, toBranchId)
  if (!isCurrentRequest()) return restoreThen(input, ctx, { status: 'abandoned' })

  let read: ReadBranchResult
  try {
    read = await readBranchWorkingSet(toBranchId, ctx, isCurrentRequest)
  } catch (err) {
    return failAndRestore(input, ctx, 'load', { error: messageOf(err) })
  }
  if (read.status === 'cancelled') return restoreThen(input, ctx, { status: 'abandoned' })
  if (read.status !== 'ok') return failAndRestore(input, ctx, 'load', { readStatus: read.status })
  if (!(await rehydrateStories(ctx.db))) return failAndRestore(input, ctx, 'stories-reread')

  // Nothing awaited from the reset to the publish, so one commit takes all three; the reset goes
  // first because a route guard can swallow it, and a fill can't be taken back.
  if (!isCurrentRequest()) return restoreThen(input, ctx, { status: 'abandoned' })
  let blocked: BlockedCause | null
  try {
    blocked = resetUnlessBlocked(input)
  } catch (err) {
    return failAndRestore(input, ctx, 'navigation-blocked', { error: messageOf(err) })
  }
  if (blocked != null) {
    logger.warn('action_layer.branch_switch_navigation_blocked', {
      storyId,
      fromBranchId,
      toBranchId,
      cause: blocked,
    })
    return restoreThen(input, ctx, { status: 'failed', code: 'navigation-blocked' })
  }
  fillAndPublish(read.set)
  chapterOverlaysStore.clearCloseResult()
  readerHoldStore.release(input.hold)
  afterBranchPublished(read.set.storyId)
  return { status: 'ok' }
}

// A run that started during the reads leaves the story-leave guard swallowing the reset, and a
// turn body's sweep can still write on the branch left once its mark has ended.
function resetUnlessBlocked(input: SwitchBranchInput): BlockedCause | null {
  const { storyId, fromBranchId, toBranchId } = input
  if (isStoryBusy(generationStore.getTxState(), storyId, fromBranchId)) return 'busy'
  if (generationStore.isTurnBodyActive(fromBranchId)) return 'turn-body'
  return input.replaceStack(toBranchId) ? null : 'reset-refused'
}

function writePointer(ctx: DbCtx, storyId: string, branchId: string): Promise<void> {
  return ctx.runInTransaction([
    ctx.db
      .update(stories)
      .set({ currentBranchId: branchId })
      .where(eq(stories.id, storyId))
      .toSQL(),
  ])
}

// The pointer went from `fromBranchId` to `toBranchId`; a restore puts it back.
type PointerMove = { storyId: string; fromBranchId: string; toBranchId: string }

// One retry: a transient failure here would leave the pointer on a branch the reader doesn't show.
async function writeRestoreWithRetry(move: PointerMove, ctx: DbCtx): Promise<void> {
  const { storyId, fromBranchId, toBranchId } = move
  try {
    await writePointer(ctx, storyId, fromBranchId)
  } catch (err) {
    logger.warn('action_layer.branch_switch_restore_retried', {
      storyId,
      fromBranchId,
      toBranchId,
      error: messageOf(err),
    })
    await writePointer(ctx, storyId, fromBranchId)
  }
}

// A pointer left on a branch the reader doesn't show would open that branch from the story list.
async function restorePointer(move: PointerMove, ctx: DbCtx): Promise<void> {
  const { storyId, fromBranchId, toBranchId } = move
  try {
    await writeRestoreWithRetry(move, ctx)
  } catch (err) {
    logger.error('action_layer.branch_switch_restore_failed', {
      storyId,
      fromBranchId,
      toBranchId,
      error: messageOf(err),
    })
  }
  // One more try keeps a transient failure off the story list.
  if (!(await rehydrateStories(ctx.db)) && !(await rehydrateStories(ctx.db))) {
    logger.error('action_layer.branch_switch_restore_reread_failed', {
      storyId,
      fromBranchId,
      toBranchId,
    })
  }
}

async function restoreThen(
  move: PointerMove,
  ctx: DbCtx,
  result: SwitchBranchResult,
): Promise<SwitchBranchResult> {
  await restorePointer(move, ctx)
  return result
}

function failAndRestore(
  input: SwitchBranchInput,
  ctx: DbCtx,
  code: FailureCode,
  detail: FailureDetail = {},
): Promise<SwitchBranchResult> {
  const { storyId, fromBranchId, toBranchId } = input
  logger.error('action_layer.branch_switch_failed', {
    storyId,
    fromBranchId,
    toBranchId,
    code,
    ...detail,
  })
  return restoreThen(input, ctx, { status: 'failed', code })
}

// The live story's fields, not the read's: a settings write that landed during the read stays.
function fillAndPublish(set: BranchWorkingSet): void {
  const { storyId, branchId } = set
  storiesStore.clearOpenFailure(storyId)
  fillWorkingSet(set)
  const live = currentStoryStore.getCurrentStory()
  currentStoryStore.set(
    live?.storyId === storyId
      ? { ...live, branchId }
      : { storyId, branchId, definition: set.definition, settings: set.settings },
  )
  navigationStore.setCurrentBranch(branchId)
}

export type ShowBranchInput = {
  storyId: string
  branchId: string
  /** The branch the reader shows: where the pointer goes back when the reset doesn't take. */
  fromBranchId: string
  hold: ReaderHoldToken
  replaceStack: (branchId: string) => boolean
}

export type ShowBranchResult =
  | { status: 'ok' }
  /** Navigated with nothing filled: the new reader's own load takes over. */
  | { status: 'shown-unloaded' }
  /** Nothing navigated or published; the pointer is back on `fromBranchId` (logged on failure). */
  | { status: 'navigation-blocked' }

/**
 * C8: shows a branch the caller's transaction made current (a fork): the switch's read, re-read
 * and block, no gate or abandon. Writes the pointer only to restore `fromBranchId` if reset fails.
 */
export async function showBranch(input: ShowBranchInput, ctx: DbCtx): Promise<ShowBranchResult> {
  const { storyId, branchId, hold, replaceStack } = input
  try {
    const set = await readForShow(storyId, branchId, ctx)
    if (!(await rehydrateStories(ctx.db))) {
      logger.warn('action_layer.branch_show_stories_reread_failed', { storyId, branchId })
    }
    // As in the switch: the reset first, then nothing awaited to the publish.
    let took: boolean
    try {
      took = replaceStack(branchId)
    } catch (err) {
      logger.warn('action_layer.branch_show_navigation_blocked', {
        storyId,
        branchId,
        error: messageOf(err),
      })
      return await blockedShow(input, ctx)
    }
    if (!took) {
      logger.warn('action_layer.branch_show_navigation_blocked', { storyId, branchId })
      return await blockedShow(input, ctx)
    }
    if (set != null) fillAndPublish(set)
    chapterOverlaysStore.clearCloseResult()
    readerHoldStore.release(hold)
    if (set == null) return { status: 'shown-unloaded' }
    afterBranchPublished(set.storyId)
    return { status: 'ok' }
  } finally {
    readerHoldStore.release(hold)
  }
}

// Awaited inside the hold: the reader takes no input until the pointer names what it shows again.
async function blockedShow(input: ShowBranchInput, ctx: DbCtx): Promise<ShowBranchResult> {
  const { storyId, fromBranchId, branchId } = input
  await restorePointer({ storyId, fromBranchId, toBranchId: branchId }, ctx)
  return { status: 'navigation-blocked' }
}

// Null when the branch doesn't load here; the new reader's own load meets the failure and reports it.
async function readForShow(
  storyId: string,
  branchId: string,
  ctx: DbCtx,
): Promise<BranchWorkingSet | null> {
  let read: ReadBranchResult
  try {
    read = await readBranchWorkingSet(branchId, ctx, () => true)
  } catch (err) {
    logger.error('action_layer.branch_show_load_failed', {
      storyId,
      branchId,
      error: messageOf(err),
    })
    return null
  }
  if (read.status === 'ok') return read.set
  logger.warn('action_layer.branch_show_load_refused', {
    storyId,
    branchId,
    readStatus: read.status,
  })
  return null
}
