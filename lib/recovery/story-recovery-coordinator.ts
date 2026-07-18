import type { OpenFailureKind } from '@/lib/stores'

type StoryRecoveryOpenResult =
  | { status: 'ok'; branchId: string }
  | { status: 'no-branch' }
  | { status: 'open-failed'; kind: OpenFailureKind }

type StoryRecoveryRequest = {
  storyId: string
  reset: () => Promise<void>
  open: (navigate: (branchId: string) => void) => Promise<StoryRecoveryOpenResult>
  navigate: (branchId: string) => void
  onOpened: () => void
  onOpenFailed: (kind: OpenFailureKind) => void
}

type StoryOpenAttempt = Pick<StoryRecoveryRequest, 'open' | 'navigate' | 'onOpenFailed'>

type ActiveRequest = {
  storyId: string
  token: number
}

export function createStoryRecoveryCoordinator() {
  let generation = 0
  let currentToken: number | null = null
  let activeRequest: ActiveRequest | null = null

  const isCurrent = (token: number) => currentToken === token

  function beginRequest(): number {
    const token = ++generation
    currentToken = token
    activeRequest = null
    return token
  }

  function invalidate(): void {
    currentToken = null
    activeRequest = null
  }

  async function attemptOpen(request: StoryOpenAttempt): Promise<void> {
    const token = beginRequest()
    try {
      const result = await request.open((branchId) => {
        if (isCurrent(token)) request.navigate(branchId)
      })
      if (isCurrent(token) && result.status === 'open-failed') {
        request.onOpenFailed(result.kind)
      }
    } finally {
      if (isCurrent(token)) currentToken = null
    }
  }

  function startReset(request: StoryRecoveryRequest): Promise<void> | undefined {
    if (activeRequest?.storyId === request.storyId) return undefined

    const token = beginRequest()
    activeRequest = { storyId: request.storyId, token }

    return (async () => {
      try {
        await request.reset()
        if (!isCurrent(token)) return

        const result = await request.open((branchId) => {
          if (isCurrent(token)) request.navigate(branchId)
        })
        if (!isCurrent(token)) return

        if (result.status === 'ok') {
          request.onOpened()
        } else if (result.status === 'open-failed') {
          request.onOpenFailed(result.kind)
        }
      } finally {
        if (isCurrent(token)) {
          currentToken = null
          activeRequest = null
        }
      }
    })()
  }

  return { attemptOpen, invalidate, startReset }
}
