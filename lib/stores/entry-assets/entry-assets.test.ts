import { describe, expect, it } from 'vitest'

import type { EntryAsset } from '@/lib/db'

import { entryAssetsStore } from './entry-assets'

function assetRow(id: string, entryId: string, position: number | null): EntryAsset {
  return { id, branchId: 'br_1', entryId, assetId: 'asset_1', role: 'header', position }
}

describe('entryAssetsStore', () => {
  it('getByEntry returns assets in position order regardless of hydration order', () => {
    entryAssetsStore.__reset()
    entryAssetsStore.hydrate('br_1', [
      assetRow('ast_2', 'entry_1', 1),
      assetRow('ast_1', 'entry_1', 0),
      assetRow('ast_x', 'entry_9', 0),
    ])
    expect(entryAssetsStore.getById('ast_1')?.position).toBe(0)
    expect(entryAssetsStore.getByEntry('entry_1').map((r) => r.id)).toEqual(['ast_1', 'ast_2'])
    expect(entryAssetsStore.getByEntry('entry_404')).toEqual([])
  })

  it('getByEntry sorts null positions last, then by id', () => {
    entryAssetsStore.__reset()
    entryAssetsStore.hydrate('br_1', [
      assetRow('ast_b', 'entry_1', null),
      assetRow('ast_a', 'entry_1', null),
      assetRow('ast_2', 'entry_1', 5),
    ])
    expect(entryAssetsStore.getByEntry('entry_1').map((r) => r.id)).toEqual([
      'ast_2',
      'ast_a',
      'ast_b',
    ])
  })

  it('no-ops a patch for a non-held branch', () => {
    entryAssetsStore.__reset()
    entryAssetsStore.hydrate('br_1', [])
    entryAssetsStore.patch('br_2', {
      op: 'create',
      id: 'ast_9',
      row: assetRow('ast_9', 'entry_9', 0),
    })
    expect(entryAssetsStore.getById('ast_9')).toBeUndefined()
  })
})
