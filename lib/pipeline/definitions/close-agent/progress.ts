import type { CloseTask } from '@/lib/db'

import type { SlotName } from './slots'

// memory/chapter-close.md → Run order: each part's prose tasks, between Happenings and Awareness.
export const PART_TASKS = [
  'lore',
  'identity',
  'threads',
  'upkeep',
  'lifecycle',
] as const satisfies readonly CloseTask[]

export type PartTask = (typeof PART_TASKS)[number]

/**
 * C6: a task's `N of M`, fixed at agent-phase start: Happenings 1, a part's tasks from
 * `2 + 5 × (part − 1)`, Awareness last, `2 + 5 × parts` in all. `part` as C4: from 1, 0 for
 * chapter-wide tasks. Throws on a task in a slot or part its order has no place for.
 */
export function closeTaskProgress(
  task: CloseTask,
  slot: SlotName,
  part: number,
  partCount: number,
): { index: number; total: number } {
  if (!Number.isInteger(partCount) || partCount < 1)
    throw new RangeError(`close progress: a close of ${partCount} parts`)
  const total = 2 + PART_TASKS.length * partCount
  if (task === 'happenings' || task === 'awareness') {
    const home: SlotName = task === 'happenings' ? 'before' : 'after'
    if (slot !== home) throw new RangeError(`close progress: ${task} in the ${slot} slot`)
    if (part !== 0)
      throw new RangeError(`close progress: ${task} runs chapter-wide, not in part ${part}`)
    return { index: task === 'happenings' ? 1 : total, total }
  }
  if (slot !== 'perPart') throw new RangeError(`close progress: ${task} in the ${slot} slot`)
  if (!Number.isInteger(part) || part < 1 || part > partCount)
    throw new RangeError(`close progress: ${task} in part ${part} of ${partCount}`)
  return { index: 2 + PART_TASKS.length * (part - 1) + PART_TASKS.indexOf(task), total }
}
