import type { OpenFailureKind } from '@/lib/stores'

type StoryRecoveryOpenResult =
  | { status: 'ok'; branchId: string }
  | { status: 'no-branch' }
  | { status: 'open-failed'; kind: OpenFailureKind }
  | { status: 'cancelled' }

type StoryRecoveryRequest = {
  storyId: string
  reset: () => Promise<void>
  open: (
    navigate: (branchId: string) => void,
    isCurrentRequest: () => boolean,
  ) => Promise<StoryRecoveryOpenResult>
  navigate: (branchId: string) => void
  onOpened: () => void
  onOpenFailed: (kind: OpenFailureKind) => void
}

type StoryOpenAttempt = Pick<StoryRecoveryRequest, 'open' | 'navigate' | 'onOpenFailed'>

export type StoryRecoveryResetOutcome =
  | { status: 'completed' }
  | { status: 'cancelled' }
  | { status: 'failed'; phase: 'reset' | 'reopen'; error: unknown }

type StoryRecoveryResetFailureHandlers = {
  onResetFailure: (error: unknown) => void
  onReopenFailure: (error: unknown) => void
}

export function handleStoryRecoveryResetOutcome(
  outcome: StoryRecoveryResetOutcome,
  handlers: StoryRecoveryResetFailureHandlers,
): void {
  if (outcome.status !== 'failed') return
  if (outcome.phase === 'reset') {
    handlers.onResetFailure(outcome.error)
  } else {
    handlers.onReopenFailure(outcome.error)
  }
}

export function createStoryRecoveryCoordinator() {
  let generation = 0
  let currentToken: number | null = null
  const resettingStories = new Set<string>()

  const isCurrent = (token: number) => currentToken === token

  function beginRequest(): number {
    const token = ++generation
    currentToken = token
    return token
  }

  function invalidate(): void {
    currentToken = null
  }

  async function attemptOpen(request: StoryOpenAttempt): Promise<void> {
    const token = beginRequest()
    try {
      let result: StoryRecoveryOpenResult
      try {
        result = await request.open(
          (branchId) => {
            if (isCurrent(token)) request.navigate(branchId)
          },
          () => isCurrent(token),
        )
      } catch (error) {
        if (isCurrent(token)) throw error
        return
      }
      if (isCurrent(token) && result.status === 'open-failed') {
        request.onOpenFailed(result.kind)
      }
    } finally {
      if (isCurrent(token)) currentToken = null
    }
  }

  function startReset(
    request: StoryRecoveryRequest,
  ): Promise<StoryRecoveryResetOutcome> | undefined {
    if (resettingStories.has(request.storyId)) return undefined

    const token = beginRequest()
    resettingStories.add(request.storyId)

    return (async () => {
      try {
        try {
          await request.reset()
        } catch (error) {
          return isCurrent(token)
            ? { status: 'failed', phase: 'reset', error }
            : { status: 'cancelled' }
        }
        if (!isCurrent(token)) return { status: 'cancelled' }

        let result: StoryRecoveryOpenResult
        try {
          result = await request.open(
            (branchId) => {
              if (isCurrent(token)) request.navigate(branchId)
            },
            () => isCurrent(token),
          )
        } catch (error) {
          return isCurrent(token)
            ? { status: 'failed', phase: 'reopen', error }
            : { status: 'cancelled' }
        }
        if (!isCurrent(token)) return { status: 'cancelled' }

        if (result.status === 'ok') {
          request.onOpened()
        } else if (result.status === 'open-failed') {
          request.onOpenFailed(result.kind)
        }
        return { status: 'completed' }
      } finally {
        resettingStories.delete(request.storyId)
        if (isCurrent(token)) {
          currentToken = null
        }
      }
    })()
  }

  return { attemptOpen, invalidate, startReset }
}
