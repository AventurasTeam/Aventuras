import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const db = {
  findSyncedLocalId: vi.fn(),
  getPack: vi.fn(),
  getAllPacks: vi.fn(),
}
vi.mock('#lib/services/database.ts', () => ({ database: db }))

const { buildBindingContext } = await import('./packBinding')

const renamed = { id: 'local', name: 'Noir Revised', author: 'Ann' }
const binding = { pack: { name: 'Noir', author: 'Ann' }, packSyncId: 'sync-1' }

beforeEach(() => {
  vi.clearAllMocks()
  db.getAllPacks.mockResolvedValue([renamed])
})

describe('buildBindingContext', () => {
  it('binds a pack renamed on one device by its sync identity', async () => {
    db.findSyncedLocalId.mockResolvedValue('local')
    db.getPack.mockResolvedValue(renamed)

    const { match } = await buildBindingContext(binding)

    expect(match).toEqual({ pack: renamed, confidence: 'exact' })
  })

  it('falls back to name and author when no local pack has the identity', async () => {
    db.findSyncedLocalId.mockResolvedValue(null)

    const { match } = await buildBindingContext(binding)

    expect(match).toEqual({ pack: null, confidence: 'none' })
  })

  it('does not look for an identity a file never carried', async () => {
    await buildBindingContext({ pack: binding.pack })

    expect(db.findSyncedLocalId).not.toHaveBeenCalled()
  })
})
