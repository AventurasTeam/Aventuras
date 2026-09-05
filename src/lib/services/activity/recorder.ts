/**
 * Activity Recorder
 *
 * Holds the turns a session has recorded and the one in flight. Plain TypeScript so the
 * gating and the append behaviour are testable; `stores/activity.svelte.ts` adds reactivity.
 *
 * Nesting is by explicit parent id rather than an implicit stack: Stage A's two branches and
 * the post-narrative phases run concurrently, so there is no single "current" step to push
 * onto.
 */

import { retainTurns, RETAINED_TURNS } from './retention'
import type { ActivityStatus, ActivityStep, ActivityTurn } from './types'

/** How much of a turn's activity the story view reports. See design.md. */
export type ActivityReporting = 'off' | 'line' | 'tree'

export interface StartStepOptions {
  /** Step this one runs inside. Omitted for a step directly under the turn. */
  parentId?: string | null
  detail?: string
  isLLM?: boolean
  /** Overrides the clock, for a step whose duration was measured elsewhere. */
  startedAt?: number
}

export class ActivityRecorder {
  private turns: ActivityTurn[] = []
  private current: ActivityTurn | null = null
  private reporting: ActivityReporting = 'off'
  private counter = 0

  constructor(
    private onChange: () => void = () => {},
    private now: () => number = Date.now,
    private bound: number = RETAINED_TURNS,
  ) {}

  /** Recording happens for any state but `off`; `line` and `tree` differ only in display. */
  get enabled(): boolean {
    return this.reporting !== 'off'
  }

  setReporting(reporting: ActivityReporting) {
    this.reporting = reporting
    if (!this.enabled && this.current) {
      // Discarded, not kept: with reporting off nothing further can close this turn, and a
      // record frozen mid-turn would come back on re-enabling with its steps still running
      // and their durations still climbing.
      this.turns = this.turns.filter((turn) => turn !== this.current)
      this.current = null
      this.onChange()
    }
  }

  startTurn(entryId: string): void {
    if (!this.enabled) return
    this.current = {
      id: `turn-${++this.counter}`,
      entryId,
      startedAt: this.now(),
      steps: [],
    }
    this.turns = retainTurns([...this.turns, this.current], this.bound)
    this.onChange()
  }

  endTurn(): void {
    if (!this.current) return
    const endedAt = this.now()
    // A turn can end with steps still open -- an abort unwinds past the `endStep` that would
    // have closed them. Left running, their durations would be measured against the time the
    // record is *viewed*, so a finished turn would report a duration that keeps growing.
    for (const step of this.current.steps) {
      if (step.status !== 'running') continue
      step.status = 'skipped'
      step.endedAt = endedAt
      step.detail ??= 'interrupted'
    }
    this.current.endedAt = endedAt
    this.current = null
    this.onChange()
  }

  /** Returns the step id to close later, or `''` when nothing was recorded. */
  startStep(label: string, options: StartStepOptions = {}): string {
    if (!this.enabled || !this.current) return ''
    const step: ActivityStep = {
      id: `step-${++this.counter}`,
      parentId: options.parentId ?? null,
      label,
      detail: options.detail,
      isLLM: options.isLLM ?? false,
      status: 'running',
      startedAt: options.startedAt ?? this.now(),
    }
    this.current.steps.push(step)
    this.onChange()
    return step.id
  }

  endStep(id: string, status: Exclude<ActivityStatus, 'running'> = 'done', detail?: string): void {
    if (!id || !this.current) return
    const step = this.current.steps.find((s) => s.id === id)
    if (!step || step.status !== 'running') return
    step.status = status
    step.endedAt = this.now()
    if (detail !== undefined) step.detail = detail
    this.onChange()
  }

  /**
   * A step that is already over — a tool call, or work timed by whoever performed it.
   * `durationMs` places the end relative to the start rather than to now.
   */
  recordStep(
    label: string,
    options: StartStepOptions & {
      status?: Exclude<ActivityStatus, 'running'>
      durationMs?: number
    } = {},
  ): string {
    const id = this.startStep(label, options)
    if (!id || !this.current) return ''
    const step = this.current.steps.find((s) => s.id === id)!
    step.status = options.status ?? 'done'
    step.endedAt = step.startedAt + (options.durationMs ?? 0)
    this.onChange()
    return id
  }

  /** The turn in flight, or null between turns. */
  get activeTurn(): ActivityTurn | null {
    return this.current
  }

  /** Retained turns, oldest first. */
  snapshot(): ActivityTurn[] {
    return this.turns.map((turn) => ({ ...turn, steps: [...turn.steps] }))
  }

  /** Discards every retained record. */
  clear(): void {
    this.turns = []
    this.current = null
    this.onChange()
  }
}
