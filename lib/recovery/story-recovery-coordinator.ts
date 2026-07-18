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
      const result = await request.open(
        (branchId) => {
          if (isCurrent(token)) request.navigate(branchId)
        },
        () => isCurrent(token),
      )
      if (isCurrent(token) && result.status === 'open-failed') {
        request.onOpenFailed(result.kind)
      }
    } finally {
      if (isCurrent(token)) currentToken = null
    }
  }

  function startReset(request: StoryRecoveryRequest): Promise<void> | undefined {
    if (resettingStories.has(request.storyId)) return undefined

    const token = beginRequest()
    resettingStories.add(request.storyId)

    return (async () => {
      try {
        await request.reset()
        if (!isCurrent(token)) return

        const result = await request.open(
          (branchId) => {
            if (isCurrent(token)) request.navigate(branchId)
          },
          () => isCurrent(token),
        )
        if (!isCurrent(token)) return

        if (result.status === 'ok') {
          request.onOpened()
        } else if (result.status === 'open-failed') {
          request.onOpenFailed(result.kind)
        }
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
