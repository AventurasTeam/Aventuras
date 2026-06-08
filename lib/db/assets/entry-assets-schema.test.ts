import { describe, expect, it } from 'vitest'

import { entryAssetWriteSchema } from './entry-assets-schema'

describe('entryAssetWriteSchema', () => {
  it('parses a full entry-asset write shape', () => {
    const r = entryAssetWriteSchema.safeParse({
      entryId: 'entry_1',
      assetId: 'asset_1',
      role: 'header',
      position: 0,
    })
    expect(r.success).toBe(true)
  })

  it('parses with the nullable role/position omitted', () => {
    const r = entryAssetWriteSchema.safeParse({ entryId: 'entry_1', assetId: 'asset_1' })
    expect(r.success).toBe(true)
  })

  it('rejects a missing assetId', () => {
    const r = entryAssetWriteSchema.safeParse({ entryId: 'entry_1' })
    expect(r.success).toBe(false)
  })
})
