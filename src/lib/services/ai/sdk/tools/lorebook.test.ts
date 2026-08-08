import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  createLoreManagementTools,
  createInteractiveVaultLorebookTools,
  type LoreManagementToolContext,
} from './lorebook'

const context: LoreManagementToolContext = {
  entries: [],
  activeLorebookId: 'lb1',
  onPendingChange: () => {},
  generateId: () => 'change-1',
}

/** The parameter names the model is shown for a tool. */
function inputKeys(tool: { inputSchema: unknown }): string[] {
  return Object.keys((tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape)
}

describe('createLoreManagementTools', () => {
  it('does not offer injectionMode, which would let it pin an entry into every prompt', () => {
    const tools = createLoreManagementTools(context)

    expect(inputKeys(tools.create_entry)).not.toContain('injectionMode')
    expect(inputKeys(tools.update_entry)).not.toContain('injectionMode')
  })

  it('leaves the rest of the entry alone', () => {
    expect(inputKeys(createLoreManagementTools(context).create_entry)).toEqual(
      expect.arrayContaining(['name', 'type', 'description', 'keywords', 'aliases', 'priority']),
    )
  })

  it('creates entries as keyword-injected', async () => {
    let created: { entry?: { injectionMode?: string } } | undefined
    const tools = createLoreManagementTools({
      ...context,
      onPendingChange: (change) => {
        created = change as typeof created
      },
    })

    await tools.create_entry.execute?.(
      {
        name: 'House of Stone',
        type: 'faction',
        description: 'A dwarven house.',
        keywords: ['Morvana'],
      } as never,
      {} as never,
    )

    expect(created?.entry?.injectionMode).toBe('keyword')
  })
})

describe('createInteractiveVaultLorebookTools', () => {
  it('keeps injectionMode: the user reads the change before it lands', () => {
    const tools = createInteractiveVaultLorebookTools(
      { lorebooks: () => [], generateId: () => 'c1' },
      context,
    ) as unknown as Record<string, { inputSchema: unknown }>

    expect(inputKeys(tools.create_entry)).toContain('injectionMode')
  })
})
