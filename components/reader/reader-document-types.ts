// components/reader/reader-document-types.ts
import type { StoryEntry } from '@/lib/db'

export type StreamingPayload = { content: string; reasoning: string }

export type EditResult = { ok: boolean }

export type ReaderSurfaceHandle = { jumpToBottom: () => void }

/**
 * Bridge contract (reader-document.md → Bridge contract): every field must be
 * JSON-serializable and every function must be async — on native these cross
 * the expo-dom bridge. Web consumes the identical shape inline.
 */
export type ReaderSurfaceProps = {
  rows: StoryEntry[]
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
  editBlocked: boolean
  jumpButtonEnabled: boolean
  /** Present when the system entry has a kind-specific fix route (host-derived label). */
  systemFixLabel?: string
  onNearTop: () => Promise<void>
  onCommitEdit: (entryId: string, content: string) => Promise<EditResult>
  onRequestRollback: (entryId: string) => Promise<void>
  onRetrySystemEntry: () => Promise<void>
  onDismissSystemEntry: () => Promise<void>
  onFixSystemEntry: () => Promise<void>
}
