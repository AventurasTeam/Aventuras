import { describe, expect, it } from 'vitest'

import { setStoryInfoOps, storyInfoPatchSchema } from './story-info-ops'
import { createTestDb } from '../__tests__/test-db'

describe('setStoryInfoOps', () => {
  it('builds one UPDATE over exactly the keys passed, serializing tags and favorite', () => {
    const ops = setStoryInfoOps(
      'story_1',
      { title: 'Aria', tags: ['a', 'b'], favorite: true, accentColor: null },
      99,
    )
    expect(ops).toEqual([
      {
        sql: 'UPDATE stories SET title = ?, tags = ?, accent_color = ?, favorite = ?, updated_at = ? WHERE id = ?',
        params: ['Aria', '["a","b"]', null, 1, 99, 'story_1'],
      },
    ])
  })

  it('returns no op for an empty or all-undefined patch', () => {
    expect(setStoryInfoOps('story_1', {}, 99)).toEqual([])
    expect(setStoryInfoOps('story_1', { title: undefined }, 99)).toEqual([])
  })

  it('trims the title and refuses an empty one', () => {
    expect(setStoryInfoOps('s', { title: '  Aria  ' }, 1)[0]?.params[0]).toBe('Aria')
    expect(() => setStoryInfoOps('s', { title: '   ' }, 1)).toThrow()
  })

  it('refuses draft as a status, a non-hex accent and a blank tag', () => {
    expect(() => storyInfoPatchSchema.parse({ status: 'draft' })).toThrow()
    expect(() => storyInfoPatchSchema.parse({ accentColor: 'blue' })).toThrow()
    expect(() => storyInfoPatchSchema.parse({ tags: ['noir', '   '] })).toThrow()
    expect(storyInfoPatchSchema.parse({ accentColor: '#3B82F6' })).toEqual({
      accentColor: '#3B82F6',
    })
  })

  it('refuses unknown keys rather than dropping them', () => {
    expect(() =>
      setStoryInfoOps('s', { settings: {} } as unknown as Record<string, never>, 1),
    ).toThrow(/settings/)
  })

  it('writes every column against the real schema, tags as JSON and favorite as 0/1', async () => {
    const { sqlite, runInTransaction } = await createTestDb()
    sqlite
      .prepare(
        'insert into stories (id, title, status, favorite, created_at, updated_at) values (?, ?, ?, ?, ?, ?)',
      )
      .run('s1', 'Old', 'active', 1, 1, 1)

    await runInTransaction(
      setStoryInfoOps(
        's1',
        {
          title: 'New',
          description: 'A blurb',
          tags: [' noir ', 'heist'],
          accentColor: '#abc',
          status: 'archived',
          favorite: false,
        },
        42,
      ),
    )

    expect(
      sqlite
        .prepare(
          'select title, description, tags, accent_color, status, favorite, updated_at from stories where id = ?',
        )
        .get('s1'),
    ).toEqual({
      title: 'New',
      description: 'A blurb',
      tags: '["noir","heist"]',
      accent_color: '#abc',
      status: 'archived',
      favorite: 0,
      updated_at: 42,
    })
  })
})
