import { describe, it, expect } from 'vitest'
import { pLimit } from './async'

describe('pLimit', () => {
  it('throws on invalid concurrency inputs', () => {
    expect(() => pLimit(0)).toThrow(TypeError)
    expect(() => pLimit(-1)).toThrow(TypeError)
    expect(() => pLimit(NaN)).toThrow(TypeError)
    expect(() => pLimit(1.5)).toThrow(TypeError)
  })

  it('limits concurrency to the specified number', async () => {
    const limit = pLimit(2)
    let active = 0
    let maxActive = 0

    const task = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
    }

    await Promise.all([limit(task), limit(task), limit(task), limit(task)])

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('does not leak slots when tasks throw synchronously', async () => {
    const limit = pLimit(1)
    let ranNext = false

    const failingTask = () => {
      throw new Error('Sync fail')
    }

    const nextTask = async () => {
      ranNext = true
    }

    await expect(limit(failingTask)).rejects.toThrow('Sync fail')
    await limit(nextTask)

    expect(ranNext).toBe(true)
  })
})
