/**
 * Activity Recorder
 *
 * Holds the records a session has kept and the ones still open. Plain TypeScript so the
 * gating and the append behaviour are testable; `stores/activity.svelte.ts` adds reactivity.
 *
 * Nesting is by explicit parent id rather than an implicit stack: Stage A's two branches and
 * the post-narrative phases run concurrently, so there is no single "current" step to push
 * onto. A parent id also chooses the record: a turn's background work and a chapter card's run
 * on after the next turn has started, and their steps follow their parents, not the newest turn.
 */

import { findTurnByEntryId, retainTurns, RETAINED_TURNS } from './retention'
import type {
  ActivityRecordKind,
  ActivityStatus,
  ActivityStep,
  ActivityTurn,
  TurnOutcome,
} from './types'

/** How much of a turn's activity the story view reports. See docs/architecture/overview.md. */
export type ActivityReporting = 'off' | 'line' | 'tree'

export interface StartStepOptions {
  /** Step this one runs inside. Omitted for a step directly under its record. */
  parentId?: string | null
  /**
   * The open record a step without a parent belongs to; `''`, from a record that was never
   * opened, records nothing. Omitted with no parent, the step joins the newest open turn.
   */
  recordId?: string
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
  /** Records still open, oldest first. */
  private open: ActivityTurn[] = []
  /** The open record each step belongs to. Steps of ended records are not in it. */
  private owner = new Map<string, ActivityTurn>()
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
    if (!this.enabled && this.open.length > 0) {
      // Discarded, not kept: with reporting off nothing further can close these records, and a
      // record frozen mid-run would come back on re-enabling with its steps still running
      // and their durations still climbing.
      const abandoned = new Set(this.open)
      this.turns = this.turns.filter((turn) => !abandoned.has(turn))
      this.open = []
      this.owner.clear()
      this.onChange()
    }
  }

  /**
   * `startedAt` backdates the turn to work that ran before this call -- input translation
   * happens before the generation path is entered, and is on the same critical path.
   *
   * Returns the turn's record id, for `endRecord`, or `''` when nothing was recorded.
   */
  startTurn(entryId: string, startedAt?: number): string {
    return this.startRecord(entryId, 'turn', startedAt)
  }

  /** Open a record keyed by `entryId`. Returns its id, or `''` when nothing was recorded. */
  startRecord(entryId: string, kind: ActivityRecordKind, startedAt?: number): string {
    if (!this.enabled) return ''
    const record: ActivityTurn = {
      id: `${kind}-${++this.counter}`,
      kind,
      entryId,
      startedAt: startedAt ?? this.now(),
      steps: [],
    }
    this.open.push(record)
    this.retain([...this.turns, record])
    this.onChange()
    return record.id
  }

  /** End the newest open turn. */
  endTurn(outcome: TurnOutcome = 'finished', error?: string | null): void {
    const turn = this.newestOpenTurn()
    if (turn) this.endRecord(turn.id, outcome, error)
  }

  endRecord(id: string, outcome: TurnOutcome = 'finished', error?: string | null): void {
    const record = this.open.find((r) => r.id === id)
    if (!record) return
    const endedAt = this.now()
    // A record can end with steps still open -- an abort unwinds past the `endStep` that would
    // have closed them. Left running, their durations would be measured against the time the
    // record is *viewed*, so a finished turn would report a duration that keeps growing.
    for (const step of record.steps) {
      this.owner.delete(step.id)
      if (step.status !== 'running') continue
      step.status = 'skipped'
      step.endedAt = endedAt
      step.detail ??= 'interrupted'
    }
    record.endedAt = endedAt
    record.outcome = outcome
    if (error) record.error = error
    this.open = this.open.filter((r) => r !== record)
    this.onChange()
  }

  /**
   * Open an ended record again, for work that resumes it: a chapter card's restarted lore run.
   * Returns its id, or `''` when it is not retained or reporting is off.
   */
  reopenRecord(entryId: string): string {
    const record = findTurnByEntryId(this.turns, entryId)
    if (!this.enabled || !record) return ''
    if (this.open.includes(record)) return record.id
    // A new object: reads of an ended record stop tracking changes, so the same one, reopened in
    // place, would never be read again by what last saw it ended.
    const { endedAt: _endedAt, outcome: _outcome, error: _error, ...rest } = record
    const reopened: ActivityTurn = rest
    this.turns = this.turns.map((r) => (r === record ? reopened : r))
    for (const step of reopened.steps) this.owner.set(step.id, reopened)
    this.open.push(reopened)
    this.onChange()
    return reopened.id
  }

  /** Drop the record keyed by `entryId`, open or not, as if it had never been kept. */
  discardRecord(entryId: string): void {
    const record = findTurnByEntryId(this.turns, entryId)
    if (!record) return
    this.forget([record])
    this.turns = this.turns.filter((r) => r !== record)
    this.onChange()
  }

  /** Returns the step id to close later, or `''` when nothing was recorded. */
  startStep(label: string, options: StartStepOptions = {}): string {
    if (!this.enabled) return ''
    // A parent no open record holds is in an ended one: work still unwinding from an ended
    // record must not land in another.
    const record = options.parentId
      ? this.owner.get(options.parentId)
      : options.recordId !== undefined
        ? this.open.find((r) => r.id === options.recordId)
        : this.newestOpenTurn()
    if (!record) return ''
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
    record.steps.push(step)
    this.owner.set(step.id, record)
    this.onChange()
    return step.id
  }

  /** Revise a running step's detail, for a counter that moves while the step is open. */
  updateStep(id: string, detail: string): void {
    const step = this.openStep(id)
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
    const step = this.openStep(id)
    if (!step || step.status !== 'running') return
    step.status = status
    step.endedAt = this.now()
    if (detail !== undefined) step.detail = detail
    if (error) step.error = error
    this.countFailure(id, step)
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
    const step = this.openStep(id)
    if (!step) return ''
    step.status = options.status ?? 'done'
    step.endedAt = step.startedAt + (options.durationMs ?? 0)
    if (options.durationMs === undefined) step.untimed = true
    if (options.error) step.error = options.error
    this.countFailure(id, step)
    this.onChange()
    return id
  }

  /**
   * Move every child of `parentId` under a new finished step spanning them, for work that turns
   * out only afterwards to be the first of several. Returns its id, or `''` with nothing to move.
   */
  groupChildren(parentId: string, label: string, options: GroupOptions = {}): string {
    const record = parentId ? this.owner.get(parentId) : undefined
    if (!record) return ''
    const children = record.steps.filter((s) => s.parentId === parentId)
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

  /** Remove a step of an open record, and anything beneath it, as if never recorded. */
  discardStep(id: string): void {
    const record = id ? this.owner.get(id) : undefined
    if (!record) return
    const steps = record.steps
    // Until nothing new is found: a group from `groupChildren` comes after its children.
    const doomed = new Set([id])
    for (let size = 0; size !== doomed.size;) {
      size = doomed.size
      for (const step of steps) if (step.parentId && doomed.has(step.parentId)) doomed.add(step.id)
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      if (!doomed.has(steps[i].id)) continue
      this.owner.delete(steps[i].id)
      steps.splice(i, 1)
    }
    this.onChange()
  }

  /** Move a turn's record to another entry, for a turn whose narration became an error entry. */
  rebindTurn(fromEntryId: string, toEntryId: string): void {
    const turn = findTurnByEntryId(this.turns, fromEntryId)
    if (!turn) return
    turn.entryId = toEntryId
    this.onChange()
  }

  /** The newest turn still open, or null when none is. */
  get activeTurn(): ActivityTurn | null {
    return this.newestOpenTurn()
  }

  /** Whether any record is still open. */
  get hasOpenRecords(): boolean {
    return this.open.length > 0
  }

  /** The most recently started turn, running or not, or null when none is retained. */
  get latestTurn(): ActivityTurn | null {
    return this.turns.findLast((record) => record.kind === 'turn') ?? null
  }

  /**
   * The retained record for an entry, or null once evicted. The live record, not a copy out of
   * `snapshot()`: callers key their reactivity off its identity.
   */
  find(entryId: string): ActivityTurn | null {
    return findTurnByEntryId(this.turns, entryId)
  }

  /** Retained records, oldest first. */
  snapshot(): ActivityTurn[] {
    return this.turns.map((turn) => ({ ...turn, steps: [...turn.steps] }))
  }

  /** Discards every retained record. */
  clear(): void {
    this.turns = []
    this.open = []
    this.owner.clear()
    this.onChange()
  }

  private newestOpenTurn(): ActivityTurn | null {
    return this.open.findLast((record) => record.kind === 'turn') ?? null
  }

  private countFailure(id: string, step: ActivityStep): void {
    if (step.status !== 'failed' && !step.error) return
    const record = this.owner.get(id)
    if (record) record.failures = (record.failures ?? 0) + 1
  }

  private openStep(id: string): ActivityStep | undefined {
    return id ? this.owner.get(id)?.steps.find((s) => s.id === id) : undefined
  }

  private retain(turns: ActivityTurn[]): void {
    const kept = retainTurns(turns, this.bound)
    const keptSet = new Set(kept)
    this.forget(turns.filter((turn) => !keptSet.has(turn)))
    this.turns = kept
  }

  /** Close nothing, but stop routing to these records. */
  private forget(records: ActivityTurn[]): void {
    if (records.length === 0) return
    const gone = new Set(records)
    for (const record of records) for (const step of record.steps) this.owner.delete(step.id)
    this.open = this.open.filter((r) => !gone.has(r))
  }
}
