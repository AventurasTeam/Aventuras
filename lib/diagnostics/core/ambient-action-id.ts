// Module-level ambient slot. Sinks in this module read it locally (no
// lib/pipeline <-> lib/diagnostics import cycle). The orchestrator sets it at
// beginRun and clears at commit/abort. Single-writer-per-branch makes a single
// mutable variable sufficient; cross-branch concurrency is parked.
let currentActionId: string | null = null

export function setCurrentActionId(actionId: string): void {
  currentActionId = actionId
}

export function clearCurrentActionId(): void {
  currentActionId = null
}

export function getCurrentActionId(): string | undefined {
  return currentActionId ?? undefined
}
