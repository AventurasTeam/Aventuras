import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PackExport } from './validation'
import type { PresetPack } from './types'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn(), readTextFile: vi.fn() }))
vi.mock('#lib/services/exportTarget.ts', () => ({ resolveSaveTarget: vi.fn() }))
vi.mock('#lib/services/templates/engine.ts', () => ({
  templateEngine: { parseTemplate: vi.fn(() => ({ success: true })) },
}))

const replacePackContents = vi.fn()
const getPack = vi.fn()

vi.mock('#lib/services/database.ts', () => ({
  database: {
    replacePackContents: (...args: unknown[]) => replacePackContents(...args),
    getPackTemplates: vi.fn(async () => []),
    getPackVariables: vi.fn(async () => []),
    getPackUsageCount: vi.fn(async () => 0),
  },
}))

vi.mock('./pack-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pack-service')>()
  return {
    ...actual,
    packService: { getPack: (...args: unknown[]) => getPack(...args) },
  }
})

const { importExportService } = await import('./import-export')

function presetPack(overrides: Partial<PresetPack> = {}): PresetPack {
  return {
    id: 'pack-1',
    name: 'Grimdark Narrator',
    description: null,
    author: null,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

const packData: PackExport = {
  version: 1,
  name: 'Grimdark Narrator',
  templates: [
    { templateId: 'adventure', content: 'tell a story' },
    { templateId: 'adventure-user', content: 'the user says' },
  ],
  variables: [],
}

describe('updatePackFromFile', () => {
  beforeEach(() => {
    replacePackContents.mockReset()
    getPack.mockReset()
  })

  it('hashes every template before the single write', async () => {
    getPack.mockResolvedValue(presetPack())

    await importExportService.updatePackFromFile('pack-1', packData)

    expect(replacePackContents).toHaveBeenCalledTimes(1)
    const [packId, data, hashes] = replacePackContents.mock.calls[0] as [
      string,
      PackExport,
      Map<string, string>,
    ]
    expect(packId).toBe('pack-1')
    expect(data).toBe(packData)
    expect([...hashes.keys()].sort()).toEqual(['adventure', 'adventure-user'])
    for (const hash of hashes.values()) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('refuses the built-in pack and writes nothing', async () => {
    getPack.mockResolvedValue(presetPack({ id: 'default-pack', isDefault: true }))

    await expect(importExportService.updatePackFromFile('default-pack', packData)).rejects.toThrow(
      /built-in pack cannot be updated/,
    )
    expect(replacePackContents).not.toHaveBeenCalled()
  })

  it('refuses a pack that does not exist', async () => {
    getPack.mockResolvedValue(null)

    await expect(importExportService.updatePackFromFile('gone', packData)).rejects.toThrow(
      /Pack not found/,
    )
    expect(replacePackContents).not.toHaveBeenCalled()
  })
})

describe('uniqueName', () => {
  it('keeps a free name, and a name the pack already holds', async () => {
    const holder = vi.spyOn(importExportService, 'checkNameConflict')
    holder.mockResolvedValueOnce(null)
    expect(await importExportService.uniqueName('Noir')).toBe('Noir')

    holder.mockResolvedValueOnce(presetPack({ id: 'mine', name: 'Noir' }))
    expect(await importExportService.uniqueName('Noir', 'mine')).toBe('Noir')
    holder.mockRestore()
  })

  it('walks the same suffixes a file import uses', async () => {
    const holder = vi.spyOn(importExportService, 'checkNameConflict')
    holder
      .mockResolvedValueOnce(presetPack({ id: 'a' }))
      .mockResolvedValueOnce(presetPack({ id: 'b' }))
      .mockResolvedValueOnce(null)
    expect(await importExportService.uniqueName('Noir')).toBe('Noir (Imported 2)')
    holder.mockRestore()
  })
})
