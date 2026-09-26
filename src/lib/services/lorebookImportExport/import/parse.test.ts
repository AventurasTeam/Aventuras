import { describe, it, expect } from 'vitest'
import { EXCHANGE_FORMAT, EXCHANGE_FORMAT_VERSION } from '$lib/services/exchange'
import { parse } from './parse'

describe('lorebookImportExport / parse', () => {
  it('rejects invalid JSON', () => {
    const res = parse('invalid json {')
    expect(res.success).toBe(false)
    expect(res.errors[0]).toContain('Failed to parse JSON')
  })

  it('parses SillyTavern lorebook JSON format', () => {
    const sillyTavernJson = JSON.stringify({
      name: 'Test World',
      entries: {
        '1': {
          uid: 1,
          key: ['dragon', 'fire'],
          keysecondary: ['lizard'],
          comment: 'Red Dragon',
          content: 'A fierce red dragon breathing fire.',
          order: 10,
          constant: false,
          selective: true,
        },
      },
    })

    const res = parse(sillyTavernJson)
    expect(res.success).toBe(true)
    expect(res.metadata.format).toBe('sillytavern')
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0].name).toBe('Red Dragon')
    expect(res.entries[0].keywords).toEqual(['dragon', 'fire', 'lizard'])
    expect(res.entries[0].injectionMode).toBe('keyword')
  })

  it('parses an Aventuras lorebook export literally, with its lorebook-level fields', () => {
    const text = JSON.stringify({
      format: EXCHANGE_FORMAT,
      formatVersion: EXCHANGE_FORMAT_VERSION,
      entity: 'lorebook',
      exportedAt: 1,
      data: {
        name: 'Arthurian Lore',
        description: 'Camelot and around.',
        tags: ['myth'],
        favorite: true,
        metadata: {},
        entries: [
          {
            name: 'Excalibur',
            type: 'item',
            description: 'Sword of power.',
            keywords: ['sword'],
            aliases: ['Holy Sword'],
            injectionMode: 'keyword',
            priority: 50,
            hiddenInfo: 'It is cursed.',
            loreManagementBlacklisted: true,
          },
        ],
      },
    })

    const res = parse(text)
    expect(res.success).toBe(true)
    expect(res.metadata.format).toBe('aventura')
    expect(res.lorebook).toEqual({
      name: 'Arthurian Lore',
      description: 'Camelot and around.',
      tags: ['myth'],
      favorite: true,
      metadata: {},
    })
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0]).toEqual({
      name: 'Excalibur',
      type: 'item',
      description: 'Sword of power.',
      keywords: ['sword'],
      aliases: ['Holy Sword'],
      injectionMode: 'keyword',
      priority: 50,
      hiddenInfo: 'It is cursed.',
      loreManagementBlacklisted: true,
    })
  })

  it('rejects a declared Aventuras export with an invalid payload instead of falling through', () => {
    const text = JSON.stringify({
      format: EXCHANGE_FORMAT,
      formatVersion: EXCHANGE_FORMAT_VERSION,
      entity: 'lorebook',
      data: { entries: { '1': { comment: 'looks like SillyTavern' } } },
    })
    const res = parse(text)
    expect(res.success).toBe(false)
    expect(res.metadata.format).toBe('aventura')
    expect(res.errors[0]).toMatch(/not valid at "name"/)
  })

  it('reports a pre-envelope raw entry array as an unknown format', () => {
    const legacy = JSON.stringify([
      {
        id: 'entry-1',
        name: 'Excalibur',
        type: 'item',
        description: 'Sword of power.',
        injection: { mode: 'keyword', priority: 50, keywords: ['sword'] },
      },
    ])
    const res = parse(legacy)
    expect(res.success).toBe(false)
    expect(res.metadata.format).toBe('unknown')
    expect(res.errors[0]).toMatch(/Unknown lorebook format/)
  })
})
