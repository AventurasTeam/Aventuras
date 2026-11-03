import { describe, expect, it } from 'vitest'
import type { SyncListItem, SyncLocalItem, SyncRow } from '#lib/types/sync.ts'
import {
  DEFAULT_LIST_PREFS,
  NEEDS_ACTION,
  buildRows,
  countByStatus,
  formatAgo,
  holdOrder,
  parseListPrefs,
  sortRows,
  viewRows,
} from './rows'

function remote(name: string, over: Partial<SyncListItem> = {}): SyncListItem {
  return { localId: `r-${name}`, name, updatedAt: 0, syncId: null, vector: null, ...over }
}

function local(name: string, over: Partial<SyncLocalItem> = {}): SyncLocalItem {
  return { ...remote(name), localId: `l-${name}`, lastSynced: {}, ...over }
}

const shared = (id: string, vector: Record<string, number>) => ({ syncId: id, vector })

describe('buildRows', () => {
  it('joins a renamed item on sync identity', () => {
    const rows = buildRows(
      'stories',
      [local('New title', shared('s', { a: 1 }))],
      [remote('Old title', shared('s', { a: 1 }))],
      'peer',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('inSync')
    expect(rows[0].action).toBeNull()
  })

  it('keeps equal names with different identities apart', () => {
    const rows = buildRows(
      'stories',
      [local('Same', shared('s1', { a: 1 }))],
      [remote('Same', shared('s2', { b: 1 }))],
      'peer',
    )
    expect(rows.map((r) => r.status).sort()).toEqual(['onlyHere', 'onlyThere'])
  })

  it('resolves a real conflict', () => {
    const [row] = buildRows(
      'stories',
      [local('Both', shared('s', { a: 2 }))],
      [remote('Both', shared('s', { a: 1, b: 1 }))],
      'peer',
    )
    expect(row).toMatchObject({ status: 'changedOnBoth', action: 'resolve' })
  })

  it('suggests an action from the status', () => {
    const rows = buildRows(
      'characters',
      [local('Ahead', shared('s1', { a: 2 })), local('Behind', shared('s2', { a: 1 }))],
      [remote('Ahead', shared('s1', { a: 1 })), remote('Behind', shared('s2', { a: 2 }))],
      'peer',
    )
    expect(rows.map((r) => r.action)).toEqual(['send', 'get'])
  })

  it('pairs a unique unsynced name into one row that asks', () => {
    const rows = buildRows('stories', [local('Keep')], [remote('Keep')], 'peer')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'sameName', action: 'choose' })
  })

  it('pairs when only one side has an identity', () => {
    const rows = buildRows('stories', [local('Keep', shared('s', { a: 1 }))], [remote('Keep')], 'p')
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('sameName')
  })

  it('refuses to pair an ambiguous name', () => {
    const rows = buildRows(
      'stories',
      [
        local('Twin', { localId: '1' }),
        local('Twin', { localId: '2' }),
        local('Twin', { localId: '3' }),
      ],
      [remote('Twin')],
      'peer',
    )
    expect(rows.filter((r) => r.status === 'sameName')).toHaveLength(0)
    expect(rows).toHaveLength(4)
  })

  it('needs the author to match for packs', () => {
    const rows = buildRows(
      'packs',
      [local('Noir', { author: 'Ann' })],
      [remote('Noir', { author: 'Bea' })],
      'peer',
    )
    expect(rows).toHaveLength(2)
  })

  it('reads the last sync for the connected device', () => {
    const [row] = buildRows(
      'stories',
      [local('A', { ...shared('s', { a: 1 }), lastSynced: { peer: 5, other: 9 } })],
      [remote('A', shared('s', { a: 1 }))],
      'peer',
    )
    expect(row.lastSyncedAt).toBe(5)
  })
})

function sample(): SyncRow[] {
  return buildRows(
    'stories',
    [
      local('Zed', shared('z', { a: 1 })),
      local('Conflict', { ...shared('c', { a: 2 }), lastSynced: { p: 10 } }),
      local('Synced', { ...shared('y', { a: 1 }), lastSynced: { p: 20 }, updatedAt: 50 }),
    ],
    [
      remote('Zed', shared('z', { a: 2 })),
      remote('Conflict', shared('c', { a: 1, b: 1 })),
      remote('Synced', shared('y', { a: 1 })),
      remote('A long name past the point of truncation'),
    ],
    'p',
  )
}

describe('viewRows', () => {
  it('shows everything by default, straight syncs first', () => {
    const view = viewRows(sample(), '', DEFAULT_LIST_PREFS)
    expect(view.rows.map((r) => r.status)).toEqual([
      'newerThere',
      'changedOnBoth',
      'onlyThere',
      'inSync',
    ])
    expect(view.hidden).toBe(0)
  })

  it('counts what a filter hides', () => {
    const prefs = { ...DEFAULT_LIST_PREFS, statuses: [...NEEDS_ACTION] }
    const view = viewRows(sample(), '', prefs)
    expect(view.rows.some((r) => r.status === 'inSync')).toBe(false)
    expect(view.hidden).toBe(1)
  })

  it('searches full names', () => {
    expect(viewRows(sample(), 'TRUNCATION', DEFAULT_LIST_PREFS).rows).toHaveLength(1)
  })

  it('counts only hidden items that match the search', () => {
    const prefs = { ...DEFAULT_LIST_PREFS, statuses: [...NEEDS_ACTION] }
    expect(viewRows(sample(), 'zed', prefs).hidden).toBe(0)
  })
})

describe('holdOrder', () => {
  const needsAction = { ...DEFAULT_LIST_PREFS, statuses: [...NEEDS_ACTION] }
  const before = buildRows(
    'stories',
    [local('Here'), local('Both', shared('b', { a: 1, peer: 0 }))],
    [remote('There'), remote('Both', shared('b', { a: 0, peer: 1 }))],
    'peer',
  )
  const held = viewRows(before, '', needsAction).rows

  it('keeps a row that is now in sync where it was', () => {
    const after = buildRows(
      'stories',
      [
        local('Here'),
        local('Both', shared('b', { a: 1, peer: 0 })),
        local('There', shared('t', { peer: 1 })),
      ],
      [remote('There', shared('t', { peer: 1 })), remote('Both', shared('b', { a: 0, peer: 1 }))],
      'peer',
    )
    const view = holdOrder(viewRows(after, '', needsAction), after, held, 'there:r-There')
    expect(view.rows.map((r) => r.name)).toEqual(held.map((r) => r.name))
    expect(view.rows.find((r) => r.name === 'There')?.status).toBe('inSync')
    expect(view.hidden).toBe(0)
  })

  it('puts a new row after the one it came from', () => {
    const after = buildRows(
      'stories',
      [local('Here'), local('Both', shared('b', { a: 1, peer: 0 })), local('Both (copy)')],
      [remote('There'), remote('Both', shared('b', { a: 0, peer: 1 }))],
      'peer',
    )
    const both = held.find((r) => r.name === 'Both')!
    const view = holdOrder(viewRows(after, '', needsAction), after, held, both.key)
    const names = view.rows.map((r) => r.name)
    expect(names[names.indexOf('Both') + 1]).toBe('Both (copy)')
    expect(names).toHaveLength(4)
  })
})

describe('sortRows', () => {
  it('keeps never-synced items last under last synced, either way', () => {
    for (const reversed of [false, true]) {
      const names = sortRows(sample(), 'lastSynced', reversed).map((r) => r.name)
      expect(names.slice(-1)[0]).not.toMatch(/Conflict|Synced/)
      expect(names.slice(0, 2).sort()).toEqual(['Conflict', 'Synced'])
    }
  })

  it('reverses', () => {
    const names = sortRows(sample(), 'name', true).map((r) => r.name)
    expect(names[0]).toBe('Zed')
  })
})

describe('countByStatus', () => {
  it('counts every status, zero included', () => {
    const counts = countByStatus(sample())
    expect(counts).toMatchObject({ changedOnBoth: 1, newerThere: 1, inSync: 1, onlyHere: 0 })
  })
})

describe('formatAgo', () => {
  const now = 1_000_000_000_000

  it('uses the largest unit that fits', () => {
    expect(formatAgo(now, now)).toBe('just now')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe('3d ago')
    expect(formatAgo(now - 14 * 86_400_000, now)).toBe('2w ago')
    expect(formatAgo(now - 90 * 86_400_000, now)).toBe('3mo ago')
  })
})

describe('parseListPrefs', () => {
  it('keeps each section separate and drops what it cannot read', () => {
    const raw = JSON.stringify({
      stories: { statuses: ['inSync', 'bogus'], sort: 'name', reversed: true },
      packs: { statuses: [], sort: 'nonsense' },
    })
    expect(parseListPrefs(raw)).toEqual({
      stories: { statuses: ['inSync'], sort: 'name', reversed: true },
    })
  })

  it('tolerates a missing or damaged value', () => {
    expect(parseListPrefs(null)).toEqual({})
    expect(parseListPrefs('{')).toEqual({})
  })
})
