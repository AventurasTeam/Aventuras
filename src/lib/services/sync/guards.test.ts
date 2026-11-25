import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SYNC_PROTOCOL_VERSION } from '#lib/types/sync.ts'
import { isEnvelopeHeader, isSyncListing, isSyncVector } from './guards'

const item = { localId: 'a', name: 'Ana', updatedAt: 1, syncId: null, vector: null }

describe('isSyncListing', () => {
  it('accepts a listing', () => {
    expect(isSyncListing({ device: { deviceId: 'pc', name: 'PC' }, items: [item] })).toBe(true)
  })

  it('rejects one with a malformed item', () => {
    const items = [{ ...item, vector: { pc: 'one' } }]
    expect(isSyncListing({ device: { deviceId: 'pc', name: 'PC' }, items })).toBe(false)
  })

  it('rejects one with no device', () => {
    expect(isSyncListing({ items: [] })).toBe(false)
  })
})

describe('isEnvelopeHeader', () => {
  const header = { section: 'packs', syncId: 's', vector: { pc: 1 }, updatedAt: 0, name: 'P' }

  it('accepts a header', () => {
    expect(isEnvelopeHeader(header)).toBe(true)
  })

  it('rejects an unknown section', () => {
    expect(isEnvelopeHeader({ ...header, section: 'notes' })).toBe(false)
  })
})

describe('isSyncVector', () => {
  it('rejects negative and fractional counters', () => {
    expect(isSyncVector({ pc: -1 })).toBe(false)
    expect(isSyncVector({ pc: 1.5 })).toBe(false)
  })
})

describe('SYNC_PROTOCOL_VERSION', () => {
  it('matches the Rust server', () => {
    const rust = readFileSync('src-tauri/src/sync/types.rs', 'utf8')
    const version = /PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/.exec(rust)?.[1]
    expect(Number(version)).toBe(SYNC_PROTOCOL_VERSION)
  })
})
