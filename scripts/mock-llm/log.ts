import { PLACEHOLDER_PREFIX_BY_KIND } from '@/lib/ids'

import type { FailureKind } from './state'

const MAX_ENTRIES = 200

// Longest prefix first so `lo1` isn't matched as `l` + `o1`.
const PLACEHOLDER_ALTERNATION = Object.values(PLACEHOLDER_PREFIX_BY_KIND)
  .sort((a, b) => b.length - a.length)
  .join('|')

// Prompts list entities as "[c1] Kael" (lib/prompts/bundled/state-emission.ts),
// which is the only place a canned reply can learn what this run's positional
// placeholders actually point at — IdBiMap allocates them per run in
// encounter order, so they mean something different every turn.
// The label stops at the next `[` as well as at the line end: rosters are
// normally one entity per line, but a prompt that lists several inline would
// otherwise fold every later entry into the first one's label.
const ROSTER_PATTERN = new RegExp(
  `\\[((?:${PLACEHOLDER_ALTERNATION})\\d+)\\]\\s*([^\\n\\r[]*)`,
  'g',
)

export type Placeholder = { ref: string; label: string }

export type LogEntry = {
  id: string
  at: number
  lane: string
  shapeName: string | null
  /** The TypeScript block this request declared, when one was recoverable. */
  block: string | null
  mode: 'mock' | 'passthrough'
  streamed: boolean
  outcome: 'ok' | 'failed' | 'aborted'
  failureKind?: FailureKind
  status: number
  durationMs: number
  responseName?: string
  note?: string
  prompt: string
  /** Assistant text served (streaming) or the structured value (non-streaming). */
  served: unknown
  placeholders: Placeholder[]
}

export function extractPlaceholders(prompt: string): Placeholder[] {
  const seen = new Map<string, string>()
  for (const match of prompt.matchAll(ROSTER_PATTERN)) {
    const [, ref, label] = match
    if (ref === undefined) continue
    if (!seen.has(ref)) seen.set(ref, (label ?? '').trim())
  }
  return [...seen].map(([ref, label]) => ({ ref, label }))
}

export class RequestLog {
  private entries: LogEntry[] = []
  private listeners = new Set<(entry: LogEntry) => void>()

  /** Whether the last narrative reply carried a <state> block. */
  lastNarrativeHadState: boolean | null = null

  push(entry: LogEntry): void {
    this.entries.unshift(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES
    for (const listener of this.listeners) listener(entry)
  }

  list(): LogEntry[] {
    return this.entries
  }

  find(id: string): LogEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  clear(): void {
    this.entries = []
    this.lastNarrativeHadState = null
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
