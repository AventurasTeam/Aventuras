import { describe, expect, it } from 'vitest'

import { AVTS_FORMAT_VERSION, AVTS_SUPPORTED_MAJOR, avtsEnvelope, avtsImportSlot } from './envelope'

const EXPORTED_AT = new Date(Date.UTC(2026, 9, 7, 9, 30))

describe('avtsEnvelope', () => {
  it('writes format, formatVersion, exportedAt, then the payload, two-space indented', () => {
    expect(avtsEnvelope('lore', { title: 'Old Roads' }, EXPORTED_AT)).toBe(
      [
        '{',
        '  "format": "aventuras-lore",',
        '  "formatVersion": "1.0",',
        '  "exportedAt": "2026-10-07T09:30:00.000Z",',
        '  "lore": {',
        '    "title": "Old Roads"',
        '  }',
        '}',
      ].join('\n'),
    )
  })

  it.each([
    ['entity', 'aventuras-entity'],
    ['lore', 'aventuras-lore'],
    ['thread', 'aventuras-thread'],
    ['happening', 'aventuras-happening'],
  ] as const)('puts a %s payload under its own key', (kind, format) => {
    const payload = { title: 'Ember Pact', tags: ['oath'] }
    const parsed = JSON.parse(avtsEnvelope(kind, payload, EXPORTED_AT))
    expect(Object.keys(parsed)).toEqual(['format', 'formatVersion', 'exportedAt', kind])
    expect(parsed.format).toBe(format)
    expect(parsed[kind]).toEqual(payload)
  })
})

describe('avtsImportSlot', () => {
  it.each([
    ['entity', 'aventuras-entity', 'entity'],
    ['lore', 'aventuras-lore', 'lore'],
    ['thread', 'aventuras-thread', 'thread'],
    ['happening', 'aventuras-happening', 'happening'],
  ] as const)('reads a %s slot as %s under %s, at major 1', (kind, format, payloadKey) => {
    expect(avtsImportSlot(kind)).toEqual({ format, payloadKey, supportedMajor: 1 })
  })
})

describe('format version', () => {
  it('reads back the major it writes', () => {
    expect(AVTS_FORMAT_VERSION).toBe('1.0')
    expect(AVTS_SUPPORTED_MAJOR).toBe(1)
    expect(Number(AVTS_FORMAT_VERSION.split('.')[0])).toBe(AVTS_SUPPORTED_MAJOR)
  })
})
