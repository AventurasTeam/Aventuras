import { describe, expect, it, vi } from 'vitest'

import { getDatabaseFileRevealAction } from './database-file'

describe('getDatabaseFileRevealAction', () => {
  it('returns a desktop action that reveals the database file', async () => {
    const revealDbFile = vi.fn().mockResolvedValue(undefined)

    const action = getDatabaseFileRevealAction('web', { revealDbFile })

    expect(action).toBeTypeOf('function')
    await action?.()
    expect(revealDbFile).toHaveBeenCalledOnce()
  })

  it('omits the action without the desktop bridge', () => {
    expect(getDatabaseFileRevealAction('web', undefined)).toBeUndefined()
  })

  it('omits the action on Android even when a bridge is present', () => {
    expect(
      getDatabaseFileRevealAction('android', {
        revealDbFile: vi.fn().mockResolvedValue(undefined),
      }),
    ).toBeUndefined()
  })
})
