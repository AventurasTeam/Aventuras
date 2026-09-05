/**
 * Activity Store
 *
 * Reactive shell over `ActivityRecorder`. The turn records are held non-reactively and the
 * UI pulls them via `snapshot()` when `version` changes -- per-step reactivity on a path
 * that appends several times a second is waste, and the same reasoning shapes `debug`.
 *
 * All logic lives in `$lib/services/activity`; this file only wires it to a rune.
 */

import {
  ActivityRecorder,
  buildTree,
  deepestRunningStep,
  findTurnByEntryId,
  type ActivityNode,
  type ActivityReporting,
  type ActivityStatus,
  type ActivityStep,
  type ActivityTurn,
  type StartStepOptions,
} from '$lib/services/activity'

class ActivityStore {
  /** Increments on every recorded change. Read it to make a derivation reactive. */
  version = $state(0)
  /** Entry whose finished record the reader has opened, if any. */
  openRecordEntryId = $state<string | null>(null)

  private recorder = new ActivityRecorder(() => this.version++)

  get enabled(): boolean {
    return this.recorder.enabled
  }

  setReporting(reporting: ActivityReporting) {
    this.recorder.setReporting(reporting)
    this.version++
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

  startTurn(entryId: string) {
    this.guard(() => this.recorder.startTurn(entryId), undefined)
  }

  endTurn() {
    this.guard(() => this.recorder.endTurn(), undefined)
  }

  startStep(label: string, options?: StartStepOptions): string {
    return this.guard(() => this.recorder.startStep(label, options), '')
  }

  endStep(id: string, status?: Exclude<ActivityStatus, 'running'>, detail?: string) {
    this.guard(() => this.recorder.endStep(id, status, detail), undefined)
  }

  recordStep(
    label: string,
    options?: StartStepOptions & {
      status?: Exclude<ActivityStatus, 'running'>
      durationMs?: number
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
    return findTurnByEntryId(this.recorder.snapshot(), entryId)
  }

  /** True while an entry's record is still retained. */
  hasRecord(entryId: string): boolean {
    return this.recordFor(entryId) !== null
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

  deepestRunning(turn: ActivityTurn): ActivityStep | null {
    void this.version
    return deepestRunningStep(turn.steps)
  }

  clear() {
    this.recorder.clear()
  }
}

export const activity = new ActivityStore()
