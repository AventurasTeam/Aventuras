import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashContent } from './hash'
import type { PackTemplate, PresetPack } from './types'

const getPack = vi.fn()
const getPackTemplates = vi.fn()
const refreshPackTemplatesToShipped = vi.fn()

vi.mock('$lib/services/database', () => ({
  database: {
    getPack: (...a: unknown[]) => getPack(...a),
    getPackTemplates: (...a: unknown[]) => getPackTemplates(...a),
    refreshPackTemplatesToShipped: (...a: unknown[]) => refreshPackTemplatesToShipped(...a),
  },
}))

const { packService } = await import('./pack-service')
const { PROMPT_TEMPLATES } = await import('$lib/services/prompts/templates')

const SHIPPED = PROMPT_TEMPLATES[0]
const OTHER = PROMPT_TEMPLATES[1]

function row(templateId: string, contentHash: string, baselineHash: string): PackTemplate {
  return {
    id: `row-${templateId}`,
    packId: 'default-pack',
    templateId,
    content: 'whatever is stored',
    contentHash,
    baselineHash,
    createdAt: 0,
    updatedAt: 0,
  }
}

function pack(overrides: Partial<PresetPack> = {}): PresetPack {
  return {
    id: 'default-pack',
    name: 'Default',
    description: null,
    author: null,
    isDefault: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

let shippedHash = ''
let otherHash = ''

beforeEach(async () => {
  getPack.mockReset()
  getPackTemplates.mockReset()
  refreshPackTemplatesToShipped.mockReset()
  getPack.mockResolvedValue(pack())
  shippedHash = await hashContent(SHIPPED.content)
  otherHash = await hashContent(OTHER.content)
})

describe('classifyPackTemplates', () => {
  it('splits the edited rows and ignores the rest', async () => {
    getPackTemplates.mockResolvedValue([
      // behind: edited, and the shipped text has moved since
      row(SHIPPED.id, 'mine', 'a-previous-shipped-hash'),
      // customised: edited, but the shipped text is what they diverged from
      row(OTHER.id, 'mine', otherHash),
      // a row the app no longer ships
      row('retired-prompt', 'mine', 'anything'),
    ])

    const result = await packService.classifyPackTemplates('default-pack')

    expect(result).toEqual({ behind: [SHIPPED.id], customised: [OTHER.id] })
  })

  it('reports nothing for a pack whose rows are all untouched', async () => {
    getPackTemplates.mockResolvedValue([row(SHIPPED.id, shippedHash, shippedHash)])

    expect(await packService.classifyPackTemplates('default-pack')).toEqual({
      behind: [],
      customised: [],
    })
  })
})

describe('refreshTemplates', () => {
  function mixedPack() {
    getPackTemplates.mockResolvedValue([
      row(SHIPPED.id, 'mine', 'a-previous-shipped-hash'),
      row(OTHER.id, 'mine', otherHash),
    ])
  }

  it('writes only the behind rows at the behind scope', async () => {
    mixedPack()

    const count = await packService.refreshTemplates('default-pack', 'behind')

    expect(count).toBe(1)
    const [, rows] = refreshPackTemplatesToShipped.mock.calls[0] as [
      string,
      { templateId: string; content: string; contentHash: string }[],
    ]
    expect(rows.map((r) => r.templateId)).toEqual([SHIPPED.id])
    expect(rows[0].content).toBe(SHIPPED.content)
    expect(rows[0].contentHash).toBe(shippedHash)
  })

  it('writes both states at the edited scope', async () => {
    mixedPack()

    const count = await packService.refreshTemplates('default-pack', 'edited')

    expect(count).toBe(2)
    const [, rows] = refreshPackTemplatesToShipped.mock.calls[0] as [
      string,
      { templateId: string }[],
    ]
    expect(rows.map((r) => r.templateId).sort()).toEqual([OTHER.id, SHIPPED.id].sort())
  })

  it('writes nothing when no template is edited', async () => {
    getPackTemplates.mockResolvedValue([row(SHIPPED.id, shippedHash, shippedHash)])

    expect(await packService.refreshTemplates('default-pack', 'edited')).toBe(0)
    expect(refreshPackTemplatesToShipped).not.toHaveBeenCalled()
  })

  it('refuses a pack that is not the built-in one', async () => {
    getPack.mockResolvedValue(pack({ id: 'custom', isDefault: false }))

    await expect(packService.refreshTemplates('custom', 'edited')).rejects.toThrow(
      /Only the built-in pack/,
    )
    expect(refreshPackTemplatesToShipped).not.toHaveBeenCalled()
  })

  it('refuses a pack that does not exist', async () => {
    getPack.mockResolvedValue(null)

    await expect(packService.refreshTemplates('gone', 'edited')).rejects.toThrow(/Pack not found/)
    expect(refreshPackTemplatesToShipped).not.toHaveBeenCalled()
  })
})
