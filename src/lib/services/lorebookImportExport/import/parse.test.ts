import { describe, it, expect } from 'vitest'
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

  it('parses Aventura lorebook JSON format', () => {
    const aventuraJson = JSON.stringify([
      {
        id: 'entry-1',
        name: 'Excalibur',
        type: 'item',
        description: 'Sword of power.',
        aliases: ['Holy Sword'],
        injection: { mode: 'keyword', priority: 50, keywords: ['sword'] },
      },
    ])

    const res = parse(aventuraJson)
    expect(res.success).toBe(true)
    expect(res.metadata.format).toBe('aventura')
    expect(res.entries).toHaveLength(1)
    expect(res.entries[0].name).toBe('Excalibur')
    expect(res.entries[0].type).toBe('item')
    expect(res.entries[0].injectionMode).toBe('keyword')
  })
})
