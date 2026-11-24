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

import type { DbCtx } from '../types'
import {
  afterBranchPublished,
  fillWorkingSet,
  readBranchWorkingSet,
  type BranchWorkingSet,
  type ReadBranchResult,
} from './operational'
import { beginSwitch } from './switch-in-flight'

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

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * C8: writes the pointer, reads the branch and re-reads the stories, then in one synchronous block
 * resets the stack and, only once the reset took, fills and publishes. Never a story open.
 */
export async function switchBranch(
  input: SwitchBranchInput,
  ctx: DbCtx,
): Promise<SwitchBranchResult> {
  // No branch: a branch held until a restart blocks neither leaving it nor entering it. Busy too:
  // a run that holds no gate would leave the story-leave guard swallowing the reset.
  const txState = generationStore.getTxState()
  if (isUserEditBlocked(txState) || isStoryBusy(txState, input.storyId, input.fromBranchId))
    return refuse(input, 'gate')
  // A failed regenerate's sweep can still be writing on the branch left with the gate open.
  if (generationStore.isTurnBodyActive(input.fromBranchId)) return refuse(input, 'turn-body')
  const settle = beginSwitch()
  if (settle == null) return refuse(input, 'running')
  try {
    return await moveAndShow(input, ctx)
  } finally {
    readerHoldStore.release(input.hold)
    settle()
  }
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
    return failAndRestore(input, ctx, 'load', err)
  }
  if (read.status === 'cancelled') return restoreThen(input, ctx, { status: 'abandoned' })
  if (read.status !== 'ok') return failAndRestore(input, ctx, 'load')
  if (!(await rehydrateStories(ctx.db))) return failAndRestore(input, ctx, 'stories-reread')

  // Nothing awaited from the reset to the publish, so one commit takes all three; the reset goes
  // first because a route guard can swallow it, and a fill can't be taken back.
  if (!isCurrentRequest()) return restoreThen(input, ctx, { status: 'abandoned' })
  // A run that started during the reads leaves the story-leave guard swallowing the reset.
  let reset = false
  try {
    reset =
      !isStoryBusy(generationStore.getTxState(), storyId, fromBranchId) &&
      input.replaceStack(toBranchId)
  } catch (err) {
    return failAndRestore(input, ctx, 'navigation-blocked', err)
  }
  if (!reset) {
    logger.warn('action_layer.branch_switch_navigation_blocked', {
      storyId,
      fromBranchId,
      toBranchId,
    })
    return restoreThen(input, ctx, { status: 'failed', code: 'navigation-blocked' })
  }
  fillAndPublish(storyId, toBranchId, read.set)
  chapterOverlaysStore.clearCloseResult()
  readerHoldStore.release(input.hold)
  afterBranchPublished(storyId)
  return { status: 'ok' }
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

// One retry: a transient failure here would leave the pointer on a branch the reader doesn't show.
async function writeRestoreWithRetry(ctx: DbCtx, storyId: string, branchId: string): Promise<void> {
  try {
    await writePointer(ctx, storyId, branchId)
  } catch {
    await writePointer(ctx, storyId, branchId)
  }
}

// A pointer left on a branch the reader doesn't show would open that branch from the story list.
async function restoreThen(
  input: SwitchBranchInput,
  ctx: DbCtx,
  result: SwitchBranchResult,
): Promise<SwitchBranchResult> {
  const { storyId, fromBranchId, toBranchId } = input
  try {
    await writeRestoreWithRetry(ctx, storyId, fromBranchId)
  } catch (err) {
    logger.error('action_layer.branch_switch_restore_failed', {
      storyId,
      fromBranchId,
      toBranchId,
      error: errorText(err),
    })
  }
  // A failed re-read logs itself; one more try keeps a transient failure off the story list.
  if (!(await rehydrateStories(ctx.db))) await rehydrateStories(ctx.db)
  return result
}

function failAndRestore(
  input: SwitchBranchInput,
  ctx: DbCtx,
  code: FailureCode,
  err?: unknown,
): Promise<SwitchBranchResult> {
  const { storyId, fromBranchId, toBranchId } = input
  logger.error('action_layer.branch_switch_failed', {
    storyId,
    fromBranchId,
    toBranchId,
    code,
    ...(err === undefined ? {} : { error: errorText(err) }),
  })
  return restoreThen(input, ctx, { status: 'failed', code })
}

// The live story's fields, not the read's: a settings write that landed during the read stays.
function fillAndPublish(storyId: string, branchId: string, set: BranchWorkingSet): void {
  storiesStore.clearOpenFailure(storyId)
  fillWorkingSet(branchId, set)
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
  hold: ReaderHoldToken
  replaceStack: (branchId: string) => boolean
}

export type ShowBranchResult =
  | { status: 'ok' }
  /** Navigated with nothing filled: the new reader's own load takes over. */
  | { status: 'shown-unloaded' }
  | { status: 'navigation-blocked' }

/**
 * C8: shows a branch its caller's own transaction made current, as a fork does: the switch's read,
 * re-read and block, with no gate, no pointer write and no abandon. It never moves the pointer.
 */
export async function showBranch(input: ShowBranchInput, ctx: DbCtx): Promise<ShowBranchResult> {
  const { storyId, branchId, hold, replaceStack } = input
  try {
    const set = await readForShow(storyId, branchId, ctx)
    if (!(await rehydrateStories(ctx.db))) {
      logger.warn('action_layer.branch_show_stories_reread_failed', { storyId, branchId })
    }
    // As in the switch: the reset first, then nothing awaited to the publish.
    if (!replaceStack(branchId)) {
      logger.warn('action_layer.branch_show_navigation_blocked', { storyId, branchId })
      return { status: 'navigation-blocked' }
    }
    if (set != null) fillAndPublish(storyId, branchId, set)
    chapterOverlaysStore.clearCloseResult()
    readerHoldStore.release(hold)
    if (set == null) return { status: 'shown-unloaded' }
    afterBranchPublished(storyId)
    return { status: 'ok' }
  } finally {
    readerHoldStore.release(hold)
  }
}

// Null when the branch doesn't load here; the new reader's own load meets the failure and reports it.
async function readForShow(
  storyId: string,
  branchId: string,
  ctx: DbCtx,
): Promise<BranchWorkingSet | null> {
  try {
    const read = await readBranchWorkingSet(branchId, ctx, () => true)
    return read.status === 'ok' ? read.set : null
  } catch (err) {
    logger.error('action_layer.branch_show_load_failed', {
      storyId,
      branchId,
      error: errorText(err),
    })
    return null
  }
}
