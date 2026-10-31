// components/reader/reader-document-types.ts
import type { CalendarFrame } from '@/lib/calendar'
import type { StoryEntry } from '@/lib/db'

import type { WorldTimeDecoration } from './worldtime-decoration'

export type StreamingPayload = { content: string; reasoning: string }

// `code` is the action layer's rejection code, so a caller can say WHY rather than
// offering a retry the refusal will never accept.
export type EditResult = { ok: true } | { ok: false; code?: string }

export type ReaderSurfaceHandle = { jumpToBottom: () => void }

/**
 * What the row controls may do: `open` lets everything through; `interruptible` (only a pass or a
 * close holds the gate) lets the head reversals through — ↻, × and the head turn's pencil — each
 * interrupting it; `closed` gates every control.
 */
export type EditGate = 'open' | 'interruptible' | 'closed'

/**
 * Bridge contract (reader-document.md → Bridge contract): every field must be
 * JSON-serializable and every function must be async — on native these cross
 * the expo-dom bridge. Web consumes the identical shape inline.
 */
export type ReaderSurfaceProps = {
  rows: StoryEntry[]
  /** Host-computed world-time labels + monotonicity flags, by entry id. Side table, not merged
   *  into `rows`: merging hands ReaderRow fresh objects each patch and voids its memo on web. */
  worldTimeDecorations: Record<string, WorldTimeDecoration>
  /** Registry-resolved calendar + story origin (fallback applied) — null hides/inerts footers. */
  worldTimeFrame: CalendarFrame | null
  /** Non-null only while the streaming row should be visible (host-gated). */
  streaming: StreamingPayload | null
  /** Branch identity: switch resets edit state and re-lands at bottom. */
  branchKey: string
  /**
   * Older entries may exist above the loaded window. Drives the boundary
   * shimmer and gates near-top load requests; host-derived from window-size
   * math (a short load proves the branch top is in the window).
   */
  hasOlder: boolean
  editGate: EditGate
  /** The tooltip on the row controls `editGate` disables; undefined while it is `open`. */
  gateReason?: string
  jumpButtonEnabled: boolean
  /** Present when the system entry has a kind-specific fix route (host-derived label). */
  systemFixLabel?: string
  /** `Fix profile`'s label for a cut-off notice; the notice shows no action when unset. */
  cutOffFixLabel?: string
  onNearTop: () => Promise<void>
  onCommitEdit: (entryId: string, content: string) => Promise<EditResult>
  onRequestRollback: (entryId: string) => Promise<void>
  onEditWorldTime: (entryId: string, nextWorldTime: number) => Promise<EditResult>
  /** Phone tier: the document requests; the host presents the native Sheet. */
  onRequestEditWorldTime: (entryId: string) => Promise<void>
  /** Resolution pool for every id the world-state panel renders. Stable identity on web. */
  entityNames: readonly { id: string; name?: string }[]
  /** Candidate pool for the scene editor's selects. Stable identity on web. */
  sceneOptions: {
    characters: { id: string; name: string }[]
    items: { id: string; name: string }[]
    locations: { id: string; name: string }[]
  }
  /** Scene fields are editable on the last entry only; null on an empty branch. */
  tailEntryId: string | null
  onEditScene: (
    entryId: string,
    next: { sceneEntities: string[]; currentLocationId: string | null },
  ) => Promise<EditResult>
  /** Phone tier: the document requests; the host presents the native Sheet. */
  onRequestEditScene: (entryId: string) => void
  onRegenerate: (entryId: string) => Promise<void>
  /** Undefined when the system entry offers no Retry (a branch held `running`). */
  onRetrySystemEntry: (() => Promise<void>) | undefined
  onDismissSystemEntry: () => Promise<void>
  /** A system entry's kept text or detail: the host writes the clipboard and toasts. */
  onCopySystemText: (text: string) => Promise<void>
  onFixSystemEntry: () => Promise<void>
  onFixCutOff: () => Promise<void>
}
