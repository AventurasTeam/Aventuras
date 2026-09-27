import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claimSlot, findSlot } from './registry'

let dir: string

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'dev-slot-registry-')), 'slots')
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

const claim = (worktree: string, live: string[], onFreshClaim = vi.fn()) =>
  claimSlot({ dir, worktree, isLive: (path) => live.includes(path), onFreshClaim })

describe('claimSlot', () => {
  it('hands out the lowest free slot and keeps it for the same worktree', () => {
    const live = ['/wt/a', '/wt/b']
    const fresh = vi.fn()
    expect(claim('/wt/a', live, fresh)).toBe(1)
    expect(claim('/wt/b', live, fresh)).toBe(2)
    expect(claim('/wt/a', live, fresh)).toBe(1)
    expect(fresh.mock.calls).toEqual([[1], [2]])
  })

  it('reclaims a slot whose worktree is gone and reports it as fresh', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '1'), '/wt/removed')
    const fresh = vi.fn()
    expect(claim('/wt/new', ['/wt/new'], fresh)).toBe(1)
    expect(fresh).toHaveBeenCalledWith(1)
    expect(findSlot(dir, '/wt/removed')).toBeUndefined()
  })

  it('fails naming the owners when every slot is taken', () => {
    const live = Array.from({ length: 9 }, (_, i) => `/wt/${i}`)
    for (const worktree of live) claim(worktree, live)
    expect(() => claim('/wt/extra', [...live, '/wt/extra'])).toThrow(/\/wt\/0[\s\S]*\/wt\/8/)
  })

  it('breaks a lock left behind by a process that died mid-claim', () => {
    mkdirSync(join(dir, '.lock'), { recursive: true })
    const old = new Date(Date.now() - 60_000)
    utimesSync(join(dir, '.lock'), old, old)
    expect(claim('/wt/a', ['/wt/a'])).toBe(1)
  })

  it('releases the lock after claiming', () => {
    claim('/wt/a', ['/wt/a'])
    expect(readdirSync(dir)).toEqual(['1'])
  })
})

describe('findSlot', () => {
  it('reads without claiming', () => {
    expect(findSlot(dir, '/wt/a')).toBeUndefined()
    claim('/wt/a', ['/wt/a'])
    expect(findSlot(dir, '/wt/a')).toBe(1)
    expect(findSlot(dir, '/wt/b')).toBeUndefined()
  })
})
