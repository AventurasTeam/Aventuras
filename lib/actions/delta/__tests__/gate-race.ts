import { vi } from 'vitest'

import { generationStore } from '@/lib/stores'

import { settleUserWrites } from '../apply-delta-action'

/**
 * Reserves a hard-gate run in a microtask after the `callNo`th user-edit gate check passes, so its
 * settleUserWrites sees the write under test only if dispatched in that check's tick. `settled`
 * resolves when the run's wait ends; `checks()` counts gate checks, to pin which `callNo` names.
 */
export function reserveRunAfterGateCheck(
  callNo: number,
  reserve: () => void,
): { settled: Promise<void>; checks: () => number; restore: () => void } {
  const real = generationStore.isUserEditBlocked
  let calls = 0
  let resolveSettled!: () => void
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = new Promise<void>((resolve, reject) => {
    resolveSettled = resolve
    timer = setTimeout(
      () => reject(new Error(`gate check ${callNo} never passed (${calls} seen)`)),
      1000,
    )
  }).finally(() => clearTimeout(timer))
  const spy = vi.spyOn(generationStore, 'isUserEditBlocked').mockImplementation(() => {
    calls += 1
    const blocked = real()
    if (calls === callNo) {
      queueMicrotask(() => {
        reserve()
        void settleUserWrites().then(resolveSettled)
      })
    }
    return blocked
  })
  return {
    settled,
    checks: () => calls,
    restore: () => {
      clearTimeout(timer)
      spy.mockRestore()
    },
  }
}
