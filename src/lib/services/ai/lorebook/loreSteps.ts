/**
 * How a lore management run reads in the activity record: why each model call is made, and a
 * step per tool call beside it. See docs/architecture/lore-management.md.
 */

import type { ActivityStatus } from '#lib/services/activity/index.ts'

/** A tool call as an agent step reports it. */
export interface StepToolCall {
  toolName: string
  input?: unknown
}

export interface ModelCallContext {
  stepNumber: number
  /** The forced last call, which may only finish. */
  isLast: boolean
  /** The tool calls of the call before this one. */
  previous: readonly StepToolCall[]
  /** Duplicate groups still open, for a call that follows a refused finish. */
  openDuplicates: number
  /** The chapter the run follows, if any. */
  newChapterNumber?: number
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function joinAnd(parts: string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** What the previous call's tools did, as the reason the loop goes on. */
function followUp(calls: readonly StepToolCall[]): string {
  const called = (...names: string[]) => calls.filter((c) => names.includes(c.toolName)).length
  const parts: string[] = []
  if (called('list_entries', 'read_entry') > 0) parts.push('reviewing entries')
  const chapters = [
    ...new Set(
      calls
        .filter((c) => c.toolName === 'query_chapter')
        .map((c) => (c.input as { chapterNumber?: number } | undefined)?.chapterNumber)
        .filter((n): n is number => typeof n === 'number'),
    ),
  ]
  if (chapters.length > 0) {
    parts.push(
      `reading ${chapters.length === 1 ? 'Chapter' : 'Chapters'} ${joinAnd(chapters.map(String))}`,
    )
  }
  const created = called('create_entry')
  if (created > 0) parts.push(`adding ${count(created, 'entry', 'entries')}`)
  const updated = called('update_entry')
  if (updated > 0) parts.push(`revising ${count(updated, 'entry', 'entries')}`)
  const deleted = called('delete_entry')
  if (deleted > 0) parts.push(`removing ${count(deleted, 'entry', 'entries')}`)
  const merged = called('merge_entries')
  if (merged > 0) parts.push(`merging ${count(merged, 'duplicate', 'duplicates')}`)
  if (called('keep_separate') > 0) parts.push('keeping duplicates apart')
  return joinAnd(parts)
}

/** Why the loop calls the model this time, known before the call is made. */
export function loreModelCallReason(context: ModelCallContext): string {
  const { stepNumber, isLast, previous, openDuplicates, newChapterNumber } = context
  if (isLast && stepNumber > 0) return 'Sum up: step limit reached'
  if (stepNumber === 0) {
    return newChapterNumber === undefined
      ? 'Review the lorebook'
      : `Review the lorebook against Chapter ${newChapterNumber}`
  }
  if (previous.some((c) => c.toolName === 'finish_lore_management') && openDuplicates > 0) {
    return `Resolve ${count(openDuplicates, 'open duplicate group', 'open duplicate groups')}`
  }
  const after = followUp(previous)
  return after ? `Continue after ${after}` : 'Continue'
}

/** The step a tool call is recorded as. `nameAt` names the entry at a lorebook index. */
export function loreToolStep(
  call: StepToolCall,
  nameAt: (index: number) => string | undefined,
): { label: string; isLLM: boolean } {
  const input = (call.input ?? {}) as {
    index?: number
    indices?: number[]
    name?: string
    query?: string
    chapterNumber?: number
  }
  const entry = (index: number | undefined) => {
    const name = index === undefined ? undefined : nameAt(index)
    return name ? `"${name}"` : `entry ${index}`
  }
  switch (call.toolName) {
    case 'list_entries':
      return {
        label: input.query ? `List entries matching "${input.query}"` : 'List entries',
        isLLM: false,
      }
    case 'read_entry':
      return { label: `Read ${entry(input.index)}`, isLLM: false }
    case 'create_entry':
      return { label: `Add "${input.name ?? 'entry'}"`, isLLM: false }
    case 'update_entry':
      return { label: `Revise ${entry(input.index)}`, isLLM: false }
    case 'delete_entry':
      return { label: `Remove ${entry(input.index)}`, isLLM: false }
    case 'merge_entries':
      return { label: `Merge ${joinAnd((input.indices ?? []).map(entry))}`, isLLM: false }
    case 'keep_separate':
      return { label: 'Keep duplicates apart', isLLM: false }
    case 'query_chapter':
      return { label: `Read Chapter ${input.chapterNumber ?? '?'}`, isLLM: true }
    case 'finish_lore_management':
      return { label: 'Finish', isLLM: false }
    default:
      return { label: call.toolName, isLLM: false }
  }
}

/** How a tool call's step closes, read from what the tool answered. */
export function loreToolOutcome(result: unknown): {
  status: Exclude<ActivityStatus, 'running'>
  detail?: string
  error?: string
} {
  const answer = (result ?? {}) as { error?: unknown; completed?: unknown }
  if (typeof answer.error === 'string') return { status: 'failed', error: answer.error }
  if (answer.completed === false) return { status: 'done', detail: 'not accepted yet' }
  return { status: 'done' }
}
