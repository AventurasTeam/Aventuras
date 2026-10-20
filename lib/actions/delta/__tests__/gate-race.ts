import { vi } from 'vitest'

import { generationStore } from '@/lib/stores'

import { settleUserWrites } from '../apply-delta-action'

/**
 * Models a hard-gate run reserving right after the `callNo`th user-edit gate check passes: in a
 * microtask, so its settleUserWrites sees the write under test only if that write was dispatched
 * in the check's own tick. `settled` resolves when that run's wait ends; `checks()` counts the
 * gate checks so far, to pin which one `callNo` names.
 */
export function reserveRunAfterGateCheck(
  callNo: number,
  reserve: () => void,
): { settled: Promise<void>; checks: () => number; restore: () => void } {
  const real = generationStore.isUserEditBlocked
  let calls = 0
  let resolveSettled!: () => void
  const settled = new Promise<void>((resolve, reject) => {
    resolveSettled = resolve
    setTimeout(() => reject(new Error(`gate check ${callNo} never passed (${calls} seen)`)), 1000)
  })
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
  return { settled, checks: () => calls, restore: () => spy.mockRestore() }
}
