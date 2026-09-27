import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MAX_SLOT } from './slot'

const LOCK_STALE_MS = 30_000
const LOCK_WAIT_MS = 10_000

function owner(dir: string, slot: number): string | undefined {
  const file = join(dir, String(slot))
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined
}

export function findSlot(dir: string, worktree: string): number | undefined {
  for (let slot = 1; slot <= MAX_SLOT; slot++) {
    if (owner(dir, slot) === worktree) return slot
  }
  return undefined
}

// Worktrees created together claim together; the lock keeps a stale reclaim from racing a fresh one.
function withLock<T>(dir: string, fn: () => T): T {
  const lock = join(dir, '.lock')
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true })
        continue
      }
      if (Date.now() > deadline) throw new Error(`dev-slot registry lock held too long: ${lock}`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
  }
  try {
    return fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

/**
 * The worktree's slot, claiming the lowest free one on first call. A slot whose owner is no longer
 * a live worktree is free; `onFreshClaim` runs whenever a slot changes hands, before it is returned.
 */
export function claimSlot(opts: {
  dir: string
  worktree: string
  isLive: (worktree: string) => boolean
  onFreshClaim: (slot: number) => void
}): number {
  const { dir, worktree, isLive, onFreshClaim } = opts
  mkdirSync(dir, { recursive: true })
  return withLock(dir, () => {
    const held = findSlot(dir, worktree)
    if (held !== undefined) return held
    for (let slot = 1; slot <= MAX_SLOT; slot++) {
      const current = owner(dir, slot)
      if (current !== undefined && isLive(current)) continue
      onFreshClaim(slot)
      writeFileSync(join(dir, String(slot)), worktree)
      return slot
    }
    const owners = Array.from({ length: MAX_SLOT }, (_, i) => `  ${i + 1}: ${owner(dir, i + 1)}`)
    throw new Error(`every dev slot is taken:\n${owners.join('\n')}`)
  })
}
