// src/test/e2e/utils/TestTracer.ts

import type { CapturedRequest } from './FetchInterceptor'

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
    this.finalize()
    return this.steps
  }
}

export function createAutoTracer(
  getStoreState: () => Record<string, unknown>,
): AutoTracer {
  return new AutoTracerImpl(getStoreState)
}
