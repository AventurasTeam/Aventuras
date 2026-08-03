import { describe, it, expect } from 'vitest'
import { isUntouched } from './pack-service'

describe('isUntouched', () => {
  it('is true for a template still exactly as the app wrote it', () => {
    expect(isUntouched({ contentHash: 'abc', baselineHash: 'abc' })).toBe(true)
  })

  it('is false once the user has edited it', () => {
    // The editor rewrites contentHash and leaves baselineHash where it was, so the two
    // diverge the moment someone saves a change.
    expect(isUntouched({ contentHash: 'edited', baselineHash: 'abc' })).toBe(false)
  })

  it('stays true across a baseline update, since both hashes move together', () => {
    // A refresh writes content and baseline from the same string, so the row remains
    // eligible for the next update.
    expect(isUntouched({ contentHash: 'v2', baselineHash: 'v2' })).toBe(true)
  })

  it("treats a row with no recorded baseline as the user's, not as stale", () => {
    // Migration 036 backfills baseline_hash from content_hash for existing rows, and the
    // database mapper falls back the same way. Whatever is stored is kept.
    expect(isUntouched({ contentHash: 'whatever', baselineHash: 'whatever' })).toBe(true)
  })

  it('treats an edit that created the row as edited, not as pristine', () => {
    // The editor saving a template its pack never had: there is no baseline to keep, so
    // `setPackTemplateContent` records the empty string rather than the edit's own hash.
    // Recording the hash would have marked a brand-new user edit untouched and handed it
    // to the next startup refresh to overwrite.
    expect(isUntouched({ contentHash: 'freshly-typed', baselineHash: '' })).toBe(false)
  })
})
