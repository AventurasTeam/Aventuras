/**
 * Activity Middleware
 *
 * Reports the attempts and waits of one request beneath the step its caller opened for it.
 * Placed directly inside `retryOn429Middleware`, so every HTTP attempt passes through it,
 * including those the SDK's own retry re-drives through the wrapped model.
 *
 * A request that succeeds first time records nothing here: its caller's step is the whole
 * story. Attempts appear only once a second one is coming, the first backfilled from memory.
 */

import type { LanguageModelMiddleware } from 'ai'
import {
  ATTEMPT_NUMBER,
  describeActivityError,
  type ActivityReporter,
} from '$lib/services/activity'
import type { RetryHooks } from './retryMiddleware'

export class AttemptTracker {
  private attempts = 0
  private backfilled = false
  private first: { startedAt: number; endedAt?: number; error?: string | null } | null = null
  private attemptId = ''
  private waitId = ''

  constructor(
    private activity: ActivityReporter,
    private parentId: string,
    private now: () => number = Date.now,
  ) {}

  /** Hooks for the retry middleware, so its waits are reported beside the attempts. */
  get retryHooks(): RetryHooks {
    return {
      onRetryWait: ({ delayMs, source, retry, maxRetries }) => {
        this.backfillFirst()
        const seconds = Math.round(delayMs / 1000)
        const why = source === 'Retry-After' ? 'as the provider asked' : 'backoff'
        this.waitId = this.activity.startStep('Waiting to retry', {
          parentId: this.parentId,
          detail: `${seconds}s ${why} · retry ${retry} of ${maxRetries}`,
        })
      },
    }
  }

  attemptStarted(): void {
    this.activity.endStep(this.waitId)
    this.waitId = ''
    this.attempts++
    if (this.attempts === 1) {
      this.first = { startedAt: this.now() }
      return
    }
    this.backfillFirst()
    // Each attempt is the actual call; the request above it becomes their container.
    this.attemptId = this.activity.startStep(`Attempt ${this.attempts}`, {
      parentId: this.parentId,
      isLLM: true,
      attempt: true,
    })
  }

  attemptSucceeded(): void {
    if (this.attempts > 1) this.activity.endStep(this.attemptId)
  }

  attemptFailed(error: unknown): void {
    const reason = describeActivityError(error)
    // Tagged after describing, so the attempt's own row reads plainly.
    if (error !== null && typeof error === 'object') {
      ;(error as Record<symbol, unknown>)[ATTEMPT_NUMBER] = this.attempts
    }
    if (this.attempts === 1 && this.first) {
      this.first.endedAt = this.now()
      this.first.error = reason
      return
    }
    this.activity.endStep(this.attemptId, reason === null ? 'skipped' : 'failed', undefined, reason)
  }

  private backfillFirst(): void {
    if (this.backfilled || !this.first) return
    this.backfilled = true
    const { startedAt, endedAt, error } = this.first
    this.activity.recordStep('Attempt 1', {
      parentId: this.parentId,
      isLLM: true,
      attempt: true,
      startedAt,
      durationMs: (endedAt ?? this.now()) - startedAt,
      status: error === null ? 'skipped' : 'failed',
      error,
    })
  }
}

/** Reports each attempt to `tracker`, passing the attempt's outcome through untouched. */
export function activityMiddleware(tracker: AttemptTracker): LanguageModelMiddleware {
  const attempt = async <T>(run: () => PromiseLike<T>): Promise<T> => {
    track(() => tracker.attemptStarted())
    try {
      const result = await run()
      track(() => tracker.attemptSucceeded())
      return result
    } catch (error) {
      track(() => tracker.attemptFailed(error))
      throw error
    }
  }
  return {
    wrapGenerate: ({ doGenerate }) => attempt(doGenerate),
    wrapStream: ({ doStream }) => attempt(doStream),
  }
}

/** Reporting must never fail the request it describes. */
function track(work: () => void): void {
  try {
    work()
  } catch (error) {
    console.warn('[activity] Attempt reporting failed (non-fatal):', error)
  }
}
