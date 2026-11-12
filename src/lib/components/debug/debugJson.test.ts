import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DebugLogEntry } from '#lib/stores/debug.svelte.ts'
import { DebugJsonCache, MAX_DISPLAY_CHARS, formatEntryJson } from './debugJson'

function entry(data: Record<string, unknown>, id = 'debug-1'): DebugLogEntry {
  return { id, timestamp: 0, type: 'request', serviceName: 'narrative', data }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatEntryJson', () => {
  it('pretty-prints the entry data', () => {
    expect(formatEntryJson(entry({ a: 1 }), false)).toBe('{\n  "a": 1\n}')
  })

  it('renders escaped newlines as line breaks only when asked', () => {
    const e = entry({ text: 'one\ntwo' })
    expect(formatEntryJson(e, false)).toContain('one\\ntwo')
    expect(formatEntryJson(e, true)).toContain('one\ntwo')
  })

  it('cuts circular references instead of throwing', () => {
    const data: Record<string, unknown> = { name: 'loop' }
    data.self = data
    expect(formatEntryJson(entry(data), false)).toContain('"[Circular]"')
  })

  it('truncates past the display limit and reports the full size', () => {
    const out = formatEntryJson(entry({ big: 'x'.repeat(MAX_DISPLAY_CHARS) }), false)
    expect(out).toContain('truncated')
    expect(out.length).toBeLessThan(MAX_DISPLAY_CHARS + 200)
  })

  it('throws when the data cannot be serialized at all', () => {
    expect(() => formatEntryJson(entry({ n: 1n }), false)).toThrow()
  })
})

describe('DebugJsonCache', () => {
  it('serializes once for the same entry and flag', () => {
    const cache = new DebugJsonCache()
    const stringify = vi.spyOn(JSON, 'stringify')
    const e = entry({ a: 1 })
    cache.get(e, false)
    cache.get(e, false)
    expect(stringify).toHaveBeenCalledTimes(1)
  })

  it('misses for a replaced entry that has the same id', () => {
    const cache = new DebugJsonCache()
    const before = entry({ a: 1 })
    const after = { ...before, data: { a: 1, b: 2 } }
    cache.get(before, false)
    expect(cache.get(after, false)).toContain('"b": 2')
  })

  it('recomputes when the newline flag flips', () => {
    const cache = new DebugJsonCache()
    const e = entry({ text: 'one\ntwo' })
    expect(cache.get(e, false)).toContain('one\\ntwo')
    expect(cache.get(e, true)).toContain('one\ntwo')
    expect(cache.get(e, false)).toContain('one\\ntwo')
  })

  it('does not cache a serialization failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cache = new DebugJsonCache()
    const e = entry({ n: 1n })
    expect(cache.get(e, false)).toContain('Serialization error')
    expect(cache.get(e, false)).toContain('Serialization error')
    expect(logged).toHaveBeenCalledTimes(2)
  })
})
