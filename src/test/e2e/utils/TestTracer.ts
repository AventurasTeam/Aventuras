// src/test/e2e/utils/TestTracer.ts

import type { CapturedRequest } from './FetchInterceptor'

export interface StoreDiff {
  storeName: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  changes: Array<{ path: string; old: unknown; new: unknown }>
}

export interface TraceStep {
  serviceId: string
  input: {
    templateInputs: Record<string, unknown>
    capturedPrompt: unknown | null
  }
  output: {
    mockedResponse: string | Record<string, unknown> | null
    storeDiffs: StoreDiff[]
  }
}

export interface TestTracer {
  beginStep(serviceId: string): void
  traceInput(data: { templateInputs: Record<string, unknown> }): void
  traceOutput(data: { mockedResponse: string | Record<string, unknown> | null }): void
  snapshotStore(storeName: string, storeData: Record<string, unknown>): void
  attachCapturedPrompt(capturedRequest: unknown): void
  getTraceData(): TraceStep[]
}

export interface AutoTraceStep {
  serviceId: string
  capturedPrompt: CapturedRequest
  mockedResponse: unknown
  templateInputs?: Record<string, unknown>
  storeDiff: {
    before: Record<string, unknown>
    after: Record<string, unknown>
    changes: Array<{ path: string; old: unknown; new: unknown }>
  }
}

export interface AutoTracer {
  onRequest(serviceId: string, request: CapturedRequest, mockData: unknown): void
  enrichStep(serviceId: string, templateInputs: Record<string, unknown>): void
  finalize(): void
  export(): AutoTraceStep[]
}

/**
 * Compute a flat list of changes between two values using dot-notation paths.
 * Handles objects, arrays, and leaf values.
 */
function computeDiff(
  before: unknown,
  after: unknown,
  prefix = '',
): Array<{ path: string; old: unknown; new: unknown }> {
  if (before === after) return []

  // Both arrays — compare element by element
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: Array<{ path: string; old: unknown; new: unknown }> = []
    const maxLen = Math.max(before.length, after.length)
    for (let i = 0; i < maxLen; i++) {
      const path = prefix ? `${prefix}.${i}` : String(i)
      if (i >= before.length) {
        changes.push({ path, old: null, new: after[i] })
      } else if (i >= after.length) {
        changes.push({ path, old: before[i], new: null })
      } else {
        changes.push(...computeDiff(before[i], after[i], path))
      }
    }
    return changes
  }

  // Both plain objects — compare key by key
  const bothObjects =
    before !== null &&
    after !== null &&
    typeof before === 'object' &&
    typeof after === 'object' &&
    !Array.isArray(before) &&
    !Array.isArray(after)

  if (bothObjects) {
    const changes: Array<{ path: string; old: unknown; new: unknown }> = []
    const allKeys = new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ])
    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key
      const oldVal = (before as Record<string, unknown>)[key]
      const newVal = (after as Record<string, unknown>)[key]
      changes.push(...computeDiff(oldVal, newVal, path))
    }
    return changes
  }

  // Leaf difference (or type mismatch: array vs object, etc.)
  return [{ path: prefix || '<root>', old: before ?? null, new: after ?? null }]
}

class TestTracerImpl implements TestTracer {
  private steps: TraceStep[] = []
  private currentStep: TraceStep | null = null
  private storeSnapshots = new Map<string, Record<string, unknown>>()

  beginStep(serviceId: string): void {
    this.finalizeCurrentStep()
    this.currentStep = {
      serviceId,
      input: { templateInputs: {}, capturedPrompt: null },
      output: { mockedResponse: null, storeDiffs: [] },
    }
    this.steps.push(this.currentStep)
    this.storeSnapshots.clear()
  }

  traceInput(data: { templateInputs: Record<string, unknown> }): void {
    if (!this.currentStep) throw new Error('Call beginStep() before traceInput()')
    this.currentStep.input.templateInputs = data.templateInputs
  }

  traceOutput(data: { mockedResponse: string | Record<string, unknown> | null }): void {
    if (!this.currentStep) throw new Error('Call beginStep() before traceOutput()')
    this.currentStep.output.mockedResponse = data.mockedResponse
  }

  snapshotStore(storeName: string, storeData: Record<string, unknown>): void {
    if (!this.currentStep) throw new Error('Call beginStep() before snapshotStore()')
    const existing = this.storeSnapshots.get(storeName)
    if (!existing) {
      this.storeSnapshots.set(storeName, structuredClone(storeData))
    } else {
      const after = structuredClone(storeData)
      this.currentStep.output.storeDiffs.push({
        storeName,
        before: existing,
        after,
        changes: computeDiff(existing, after),
      })
      this.storeSnapshots.delete(storeName)
    }
  }

  attachCapturedPrompt(capturedRequest: unknown): void {
    if (!this.currentStep) throw new Error('Call beginStep() before attachCapturedPrompt()')
    this.currentStep.input.capturedPrompt = capturedRequest
  }

  getTraceData(): TraceStep[] {
    this.finalizeCurrentStep()
    return this.steps
  }

  private finalizeCurrentStep(): void {
    if (this.currentStep) {
      for (const [storeName, before] of this.storeSnapshots) {
        this.currentStep.output.storeDiffs.push({
          storeName,
          before,
          after: {},
          changes: computeDiff(before, {}),
        })
      }
      this.storeSnapshots.clear()
    }
  }
}

class AutoTracerImpl implements AutoTracer {
  private steps: AutoTraceStep[] = []
  private lastSnapshot: Record<string, unknown> | null = null
  private getStoreState: () => Record<string, unknown>

  constructor(getStoreState: () => Record<string, unknown>) {
    this.getStoreState = getStoreState
  }

  onRequest(serviceId: string, request: CapturedRequest, mockData: unknown): void {
    const currentSnapshot = this.getStoreState()

    // Close previous step's diff
    if (this.steps.length > 0 && this.lastSnapshot) {
      const prevStep = this.steps[this.steps.length - 1]
      prevStep.storeDiff = {
        before: this.lastSnapshot,
        after: currentSnapshot,
        changes: computeDiff(this.lastSnapshot, currentSnapshot),
      }
    }

    // Create new step
    this.steps.push({
      serviceId,
      capturedPrompt: request,
      mockedResponse: mockData ?? null,
      storeDiff: {
        before: currentSnapshot,
        after: currentSnapshot,
        changes: [],
      },
    })

    this.lastSnapshot = currentSnapshot
  }

  enrichStep(serviceId: string, templateInputs: Record<string, unknown>): void {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i].serviceId === serviceId) {
        this.steps[i].templateInputs = templateInputs
        return
      }
    }
  }

  finalize(): void {
    if (this.steps.length === 0) return
    const currentSnapshot = this.getStoreState()
    const lastStep = this.steps[this.steps.length - 1]
    lastStep.storeDiff = {
      before: this.lastSnapshot ?? currentSnapshot,
      after: currentSnapshot,
      changes: computeDiff(this.lastSnapshot ?? currentSnapshot, currentSnapshot),
    }
  }

  export(): AutoTraceStep[] {
    return this.steps
  }
}

/**
 * Create a new TestTracer instance.
 *
 * Usage: call this at the start of a test, then at the end assign
 * `task.meta.traceData = tracer.getTraceData()` so the reporter can read it.
 */
export function createTracer(): TestTracer {
  return new TestTracerImpl()
}

export function createAutoTracer(
  getStoreState: () => Record<string, unknown>,
): AutoTracer {
  return new AutoTracerImpl(getStoreState)
}
