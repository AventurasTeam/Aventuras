import { describe, expect, it } from 'vitest'

import { CLOSE_TASKS, type CloseTask } from '@/lib/db'

import { closeTaskProgress } from './progress'

// memory/chapter-close.md → Run order: Happenings, each part's five prose tasks, Awareness.
const PART_TASKS: readonly CloseTask[] = ['lore', 'identity', 'threads', 'upkeep', 'lifecycle']

function runOrder(parts: number): { task: CloseTask; part: number }[] {
  return [
    { task: 'happenings', part: 0 },
    ...Array.from({ length: parts }, (_, p) =>
      PART_TASKS.map((task) => ({ task, part: p + 1 })),
    ).flat(),
    { task: 'awareness', part: 0 },
  ]
}

describe('closeTaskProgress', () => {
  it('counts Identity 3 of 7 on a chapter of one part', () => {
    expect(closeTaskProgress('identity', 1, 1)).toEqual({ index: 3, total: 7 })
  })

  it('counts of 17 on a chapter of three parts', () => {
    expect(closeTaskProgress('identity', 1, 3)).toEqual({ index: 3, total: 17 })
    expect(closeTaskProgress('lifecycle', 3, 3)).toEqual({ index: 16, total: 17 })
    expect(closeTaskProgress('awareness', 0, 3)).toEqual({ index: 17, total: 17 })
  })

  it.each([1, 2, 3])('numbers every task of a %i-part close 1 to N in run order', (parts) => {
    const order = runOrder(parts)
    expect(order.map(({ task, part }) => closeTaskProgress(task, part, parts))).toEqual(
      order.map((_, i) => ({ index: i + 1, total: order.length })),
    )
  })

  // The sweep above covers every task only if the stated order names them all.
  it('places every close task', () => {
    expect(new Set(runOrder(1).map(({ task }) => task))).toEqual(new Set(CLOSE_TASKS))
  })

  it.each([
    ['a part task outside a part', 'identity', 0, 1],
    ['a part past the count', 'identity', 2, 1],
    ['a chapter-wide task inside a part', 'happenings', 1, 1],
    ['a close of no parts', 'lore', 1, 0],
  ] as const)('refuses %s', (_, task, part, partCount) => {
    expect(() => closeTaskProgress(task, part, partCount)).toThrow(RangeError)
  })
})
