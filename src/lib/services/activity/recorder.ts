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

import { findTurnByEntryId, retainTurns, RETAINED_TURNS } from './retention'
import type { ActivityStatus, ActivityStep, ActivityTurn, TurnOutcome } from './types'

/** How much of a turn's activity the story view reports. See docs/architecture/overview.md. */
export type ActivityReporting = 'off' | 'line' | 'tree'

export interface StartStepOptions {
  /** Step this one runs inside. Omitted for a step directly under the turn. */
  parentId?: string | null
  detail?: string
  isLLM?: boolean
  /** See `ActivityStep.attempt`. */
  attempt?: boolean
  /** Overrides the clock, for a step whose duration was measured elsewhere. */
  startedAt?: number
}

/** How `groupChildren` records the step it adds. */
export type GroupOptions = Pick<StartStepOptions, 'detail' | 'attempt'> & {
  status?: Exclude<ActivityStatus, 'running'>
  error?: string | null
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

  /**
   * `startedAt` backdates the turn to work that ran before this call -- input translation
   * happens before the generation path is entered, and is on the same critical path.
   */
  startTurn(entryId: string, startedAt?: number): void {
    if (!this.enabled) return
    this.current = {
      id: `turn-${++this.counter}`,
      entryId,
      startedAt: startedAt ?? this.now(),
      steps: [],
    }
    this.turns = retainTurns([...this.turns, this.current], this.bound)
    this.onChange()
  }

  endTurn(outcome: TurnOutcome = 'finished', error?: string | null): void {
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
    this.current.outcome = outcome
    if (error) this.current.error = error
    this.current = null
    this.onChange()
  }

  /** Returns the step id to close later, or `''` when nothing was recorded. */
  startStep(label: string, options: StartStepOptions = {}): string {
    if (!this.enabled || !this.current) return ''
    // Work still unwinding from an ended turn must not land in the next one.
    if (options.parentId && !this.current.steps.some((s) => s.id === options.parentId)) return ''
    const step: ActivityStep = {
      id: `step-${++this.counter}`,
      parentId: options.parentId ?? null,
      label,
      detail: options.detail,
      isLLM: options.isLLM ?? false,
      ...(options.attempt ? { attempt: true } : {}),
      status: 'running',
      startedAt: options.startedAt ?? this.now(),
    }
    this.current.steps.push(step)
    this.onChange()
    return step.id
  }

  /** Revise a running step's detail, for a counter that moves while the step is open. */
  updateStep(id: string, detail: string): void {
    if (!id || !this.current) return
    const step = this.current.steps.find((s) => s.id === id)
    if (!step || step.status !== 'running' || step.detail === detail) return
    step.detail = detail
    this.onChange()
  }

  endStep(
    id: string,
    status: Exclude<ActivityStatus, 'running'> = 'done',
    detail?: string,
    error?: string | null,
  ): void {
    if (!id || !this.current) return
    const step = this.current.steps.find((s) => s.id === id)
    if (!step || step.status !== 'running') return
    step.status = status
    step.endedAt = this.now()
    if (detail !== undefined) step.detail = detail
    if (error) step.error = error
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
      error?: string | null
    } = {},
  ): string {
    const id = this.startStep(label, options)
    if (!id || !this.current) return ''
    const step = this.current.steps.find((s) => s.id === id)!
    step.status = options.status ?? 'done'
    step.endedAt = step.startedAt + (options.durationMs ?? 0)
    if (options.durationMs === undefined) step.untimed = true
    if (options.error) step.error = options.error
    this.onChange()
    return id
  }

  /**
   * Move every child of `parentId` under a new finished step spanning them, for work that turns
   * out only afterwards to be the first of several. Returns its id, or `''` with nothing to move.
   */
  groupChildren(parentId: string, label: string, options: GroupOptions = {}): string {
    if (!parentId || !this.current) return ''
    const children = this.current.steps.filter((s) => s.parentId === parentId)
    if (children.length === 0) return ''
    const startedAt = Math.min(...children.map((s) => s.startedAt))
    const endedAt = Math.max(...children.map((s) => s.endedAt ?? this.now()))
    const id = this.recordStep(label, {
      ...options,
      parentId,
      startedAt,
      durationMs: endedAt - startedAt,
    })
    for (const child of children) child.parentId = id
    this.onChange()
    return id
  }

  /** Remove a step of the turn in flight, and anything beneath it, as if never recorded. */
  discardStep(id: string): void {
    if (!id || !this.current) return
    const steps = this.current.steps
    // Until nothing new is found: a group from `groupChildren` comes after its children.
    const doomed = new Set([id])
    for (let size = 0; size !== doomed.size;) {
      size = doomed.size
      for (const step of steps) if (step.parentId && doomed.has(step.parentId)) doomed.add(step.id)
    }
    for (let i = steps.length - 1; i >= 0; i--) if (doomed.has(steps[i].id)) steps.splice(i, 1)
    this.onChange()
  }

  /** Move a turn's record to another entry, for a turn whose narration became an error entry. */
  rebindTurn(fromEntryId: string, toEntryId: string): void {
    const turn = findTurnByEntryId(this.turns, fromEntryId)
    if (!turn) return
    turn.entryId = toEntryId
    this.onChange()
  }

  /** The turn in flight, or null between turns. */
  get activeTurn(): ActivityTurn | null {
    return this.current
  }

  /** The most recently started turn, running or not, or null when none is retained. */
  get latestTurn(): ActivityTurn | null {
    return this.turns.at(-1) ?? null
  }

  /**
   * The retained record for an entry, or null once evicted. The live turn, not a copy out of
   * `snapshot()`: callers key their reactivity off its identity.
   */
  find(entryId: string): ActivityTurn | null {
    return findTurnByEntryId(this.turns, entryId)
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
