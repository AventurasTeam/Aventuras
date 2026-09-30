/**
 * Activity Store
 *
 * Reactive shell over `ActivityRecorder`. The turn records are held non-reactively and the
 * UI pulls them via `snapshot()` when `version` changes -- per-step reactivity on a path
 * that appends several times a second is waste, and the same reasoning shapes `debug`.
 *
 * All logic lives in `$lib/services/activity`; this file only wires it to a rune.
 */

import { SvelteMap } from 'svelte/reactivity'
import {
  ActivityRecorder,
  buildTree,
  deepestRunningStep,
  type ActivityNode,
  type ActivityReporting,
  type ActivityStatus,
  type ActivityStep,
  type ActivityTurn,
  type StartStepOptions,
  type TurnOutcome,
} from '$lib/services/activity'

class ActivityStore {
  /** Increments on every recorded change. Read it to make a derivation reactive. */
  version = $state(0)

  /**
   * Advances while a turn is in flight, so elapsed times tick. Shared rather than owned by a
   * component: the streaming entry and the finished one both read it, and the report has to
   * keep counting across the handover between them.
   */
  now = $state(Date.now())
  private clock: ReturnType<typeof setInterval> | null = null

  /**
   * Two independent controls, both keyed by entry rather than held per component: a report
   * opened during generation has to survive the streaming entry giving way to the finished
   * one, which is what keeps the post-narrative steps on screen.
   *
   * Each map holds only what the reader has actually chosen. Absent means "whatever the
   * default is here": the report shows itself, and the tree follows the reporting setting while
   * it is the latest turn, and is the line once a newer turn has started.
   */
  private reportVisible = new SvelteMap<string, boolean>()
  private treeExpanded = new SvelteMap<string, boolean>()
  private reporting: ActivityReporting = 'off'

  private recorder = new ActivityRecorder(() => this.version++)

  get enabled(): boolean {
    return this.recorder.enabled
  }

  setReporting(reporting: ActivityReporting) {
    this.reporting = reporting
    this.recorder.setReporting(reporting)
    if (reporting === 'off') this.stopClock()
    this.version++
  }

  /** Whether the report shows at all. Shown until the reader hides it. */
  isReportVisible(entryId: string): boolean {
    return this.reportVisible.get(entryId) ?? true
  }

  setReportVisible(entryId: string, visible: boolean) {
    this.reportVisible.set(entryId, visible)
  }

  /** Whether the report is showing the full timeline rather than the line. */
  isTreeExpanded(turn: ActivityTurn): boolean {
    return this.treeExpanded.get(turn.entryId) ?? (this.isLatest(turn) && this.reporting === 'tree')
  }

  private isLatest(turn: ActivityTurn): boolean {
    void this.version
    return this.recorder.latestTurn === turn
  }

  setTreeExpanded(entryId: string, expanded: boolean) {
    this.treeExpanded.set(entryId, expanded)
  }

  private startClock() {
    if (this.clock) return
    // Once a second, matching the resolution durations are shown at.
    this.clock = setInterval(() => (this.now = Date.now()), 1000)
  }

  private stopClock() {
    if (!this.clock) return
    clearInterval(this.clock)
    this.clock = null
  }

  /**
   * Recording is a bystander to the turn. Every write is guarded so a fault in the record
   * cannot take down the generation it is describing.
   */
  private guard<T>(work: () => T, fallback: T): T {
    try {
      return work()
    } catch (error) {
      console.warn('[activity] Recording failed (non-fatal):', error)
      return fallback
    }
  }

  startTurn(entryId: string, startedAt?: number) {
    this.guard(() => this.recorder.startTurn(entryId, startedAt), undefined)
    if (!this.recorder.enabled) return
    this.now = Date.now()
    this.startClock()
  }

  rebindTurn(fromEntryId: string, toEntryId: string) {
    this.guard(() => this.recorder.rebindTurn(fromEntryId, toEntryId), undefined)
  }

  endTurn(outcome?: TurnOutcome, error?: string | null) {
    this.guard(() => this.recorder.endTurn(outcome, error), undefined)
    this.now = Date.now()
    this.stopClock()
  }

  startStep(label: string, options?: StartStepOptions): string {
    return this.guard(() => this.recorder.startStep(label, options), '')
  }

  updateStep(id: string, detail: string) {
    this.guard(() => this.recorder.updateStep(id, detail), undefined)
  }

  endStep(
    id: string,
    status?: Exclude<ActivityStatus, 'running'>,
    detail?: string,
    error?: string | null,
  ) {
    this.guard(() => this.recorder.endStep(id, status, detail, error), undefined)
  }

  recordStep(
    label: string,
    options?: StartStepOptions & {
      status?: Exclude<ActivityStatus, 'running'>
      durationMs?: number
      error?: string | null
    },
  ): string {
    return this.guard(() => this.recorder.recordStep(label, options), '')
  }

  /** The turn in flight. Touches `version` so callers re-read as it grows. */
  get activeTurn(): ActivityTurn | null {
    void this.version
    return this.recorder.activeTurn
  }

  /** The retained record for an entry, or null once evicted. */
  recordFor(entryId: string): ActivityTurn | null {
    void this.version
    return this.recorder.find(entryId)
  }

  /**
   * The reads below touch `version` for the same reason `activeTurn` does: a turn is one
   * object whose `steps` array is mutated in place, so nothing about it changes identity as
   * the turn runs. Without the rune read, a `$derived` over these computes once -- against an
   * empty step list -- and never again.
   */
  tree(turn: ActivityTurn): ActivityNode[] {
    void this.version
    return buildTree(turn.steps)
  }

  /** Why the turn halted, or null when it did not. */
  haltReason(turn: ActivityTurn): string | null {
    void this.version
    return turn.outcome === 'halted' ? (turn.error ?? '') : null
  }

  hasEnded(turn: ActivityTurn): boolean {
    void this.version
    return turn.endedAt !== undefined
  }

  deepestRunning(turn: ActivityTurn): ActivityStep | null {
    void this.version
    return deepestRunningStep(turn.steps)
  }

  clear() {
    this.recorder.clear()
    this.reportVisible.clear()
    this.treeExpanded.clear()
    this.stopClock()
  }
}

export const activity = new ActivityStore()
