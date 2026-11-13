import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DebugLogEntry } from '#lib/stores/debugLog.ts'
import { DebugJsonCache, MAX_DISPLAY_CHARS, formatEntryJson } from './debugJson'

function entry(data: Record<string, unknown>, id = 'debug-1'): DebugLogEntry {
  return { id, timestamp: 0, type: 'request', serviceName: 'narrative', data }
}

const text = (data: Record<string, unknown>, readable = false) =>
  formatEntryJson(entry(data), readable).text

/** Throws when `JSON.stringify` reaches it. */
const unserializable = {
  toJSON(): never {
    throw new Error('cannot serialize')
  },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatEntryJson', () => {
  it('pretty-prints the entry data', () => {
    expect(text({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('renders escaped newlines as line breaks only when readable', () => {
    const data = { text: 'one\ntwo' }
    expect(text(data)).toContain('one\\ntwo')
    expect(text(data, true)).toContain('one\ntwo')
  })

  it('cuts circular references instead of throwing', () => {
    const data: Record<string, unknown> = { name: 'loop' }
    data.self = data
    expect(text(data)).toContain('"self": "[Circular]"')
  })

  it('does not mark a shared reference that is not a cycle', () => {
    const shared = { n: 1 }
    expect(text({ a: shared, b: shared })).not.toContain('Circular')
  })

  it('shows a bigint as text', () => {
    expect(text({ n: 12n })).toContain('"12n"')
  })

  it('leaves values with toJSON to stringify', () => {
    expect(text({ when: new Date(0) })).toContain('1970-01-01T00:00:00.000Z')
  })

  it('throws when the data cannot be serialized at all', () => {
    expect(() => text({ bad: unserializable })).toThrow('cannot serialize')
  })

  it('does not let a __proto__ key change the prototype', () => {
    const data = JSON.parse('{"__proto__": {"x": 1}}') as Record<string, unknown>
    expect(text(data)).toContain('"__proto__"')
  })
})

describe('JSON text', () => {
  const data = { body: { content: { text: '{"ids":[1,2],"note":"a\\nb"}' } }, plain: '{ not json' }

  it('flags a string that holds JSON and leaves it a string when not readable', () => {
    const out = formatEntryJson(entry(data), false)
    expect(out.jsonText).toBe(true)
    expect(JSON.parse(out.text)).toEqual(data)
  })

  it('expands it into the value it holds when readable', () => {
    const out = formatEntryJson(entry(data), true)
    expect(out.jsonText).toBe(true)
    expect(out.text).toContain('"ids": [\n')
    expect(out.text).not.toContain('{"ids"')
  })

  it('expands JSON text nested in JSON text', () => {
    const inner = JSON.stringify({ deep: true })
    const outer = JSON.stringify({ inner })
    expect(text({ outer }, true)).toContain('"deep": true')
  })

  it('does not flag text that only looks like JSON', () => {
    const out = formatEntryJson(
      entry({ a: '{ not json', b: '[base64, 2048 chars]', c: 'plain' }),
      true,
    )
    expect(out.jsonText).toBe(false)
    expect(out.text).toContain('"{ not json"')
  })
})

describe('truncation', () => {
  const marginFor = (out: string) => out.length - MAX_DISPLAY_CHARS

  it('cuts a giant string and still gives valid JSON', () => {
    const out = text({ big: 'x'.repeat(MAX_DISPLAY_CHARS * 2), after: 'kept?' })

    const parsed = JSON.parse(out) as Record<string, string>
    expect(parsed.big).toMatch(/… \[\d[\d,]* more chars\]$/)
    expect(marginFor(out)).toBeLessThan(200)
    expect(parsed['…']).toBe('1 more keys')
  })

  it('collapses the rest of a long array into one marker', () => {
    const list = Array.from({ length: 100_000 }, (_, i) => `item ${i}`)
    const out = text({ list })

    const parsed = JSON.parse(out) as { list: string[] }
    expect(parsed.list.at(-1)).toMatch(/^… [\d,]+ more items$/)
    expect(parsed.list.length).toBeLessThan(list.length)
    expect(marginFor(out)).toBeLessThan(200)
  })

  it('cuts a string made mostly of escapes near the limit', () => {
    const out = text({ big: '\n'.repeat(MAX_DISPLAY_CHARS) })
    expect(JSON.parse(out)).toBeTruthy()
    expect(marginFor(out)).toBeLessThan(200)
  })

  it.each([120_000, 140_000, 150_000])(
    'cuts a string of %i newlines whose raw length fits but whose escaped length does not',
    (count) => {
      const out = text({ big: '\n'.repeat(count) })

      const parsed = JSON.parse(out) as { big: string }
      expect(parsed.big).toMatch(/… \[\d[\d,]* more chars\]$/)
      expect(marginFor(out)).toBeLessThan(200)
    },
  )

  it('charges a cut string at its escaped size, so a later field is cut too', () => {
    const out = text({ a: '\n'.repeat(300_000), b: '\n'.repeat(300_000) })

    const parsed = JSON.parse(out) as Record<string, string>
    expect(parsed['…']).toBe('1 more keys')
    expect(marginFor(out)).toBeLessThan(200)
  })

  it('never cuts between the halves of a surrogate pair', () => {
    for (let pad = 0; pad < 8; pad++) {
      const big = `${'a'.repeat(pad)}${'😀\n'.repeat(MAX_DISPLAY_CHARS)}`
      const parsed = JSON.parse(text({ big })) as { big: string }
      expect(parsed.big).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    }
  })

  it('leaves data under the limit alone', () => {
    expect(text({ a: 'x'.repeat(1000) })).not.toContain('more')
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
    expect(cache.get(after, false).text).toContain('"b": 2')
  })

  it('recomputes when the readable flag flips', () => {
    const cache = new DebugJsonCache()
    const e = entry({ text: 'one\ntwo', json: '{"a":1}' })
    expect(cache.get(e, false).text).toContain('one\\ntwo')
    expect(cache.get(e, true).text).toContain('one\ntwo')
    expect(cache.get(e, true).text).toContain('"a": 1')
    expect(cache.get(e, false).text).toContain('one\\ntwo')
  })

  it('reports JSON text for either mode', () => {
    const cache = new DebugJsonCache()
    const e = entry({ json: '{"a":1}' })
    expect(cache.get(e, false).jsonText).toBe(true)
    expect(cache.get(e, true).jsonText).toBe(true)
  })

  it('does not cache a serialization failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cache = new DebugJsonCache()
    const e = entry({ bad: unserializable })
    expect(cache.get(e, false).text).toContain('Serialization error')
    expect(cache.get(e, false).text).toContain('Serialization error')
    expect(logged).toHaveBeenCalledTimes(2)
  })
})
