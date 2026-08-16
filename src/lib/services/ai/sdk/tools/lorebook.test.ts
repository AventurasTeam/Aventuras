import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  createLoreManagementTools,
  createInteractiveVaultLorebookTools,
  type LoreManagementToolContext,
  type LorebookEntryToolContext,
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

  it('does not offer lorebookId, which names nothing in a story lorebook', () => {
    const tools = createLoreManagementTools(context) as unknown as Record<
      string,
      { inputSchema: unknown }
    >

    for (const name of [
      'read_entry',
      'create_entry',
      'update_entry',
      'delete_entry',
      'merge_entries',
    ]) {
      expect(inputKeys(tools[name]), name).not.toContain('lorebookId')
    }
  })

  it('reads the bound entries when the model cannot name a lorebook', async () => {
    // The regression this pins: a run that invented `lorebookId: "lorebook_1"` got
    // `Global lorebook access not available in this context` from every read tool, and
    // could only create.
    const tools = createLoreManagementTools({ ...context, entries: [entry('Kaelen')] })

    const read = (await tools.read_entry.execute?.({ index: 0 } as never, {} as never)) as {
      found: boolean
      error?: string
    }

    expect(read.error).toBeUndefined()
    expect(read.found).toBe(true)
  })

  it('offers no list_entries: the prompt already carries every entry with its index', () => {
    const tools = createLoreManagementTools(context) as unknown as Record<string, unknown>

    expect(tools.list_entries).toBeUndefined()
    // read_entry stays — it reads one entry, it does not restate the list.
    expect(tools.read_entry).toBeDefined()
  })

  it('reports where a merge landed, which is how the agent tracks the index space', async () => {
    // Without it the only way to find out was a listing, and the listing is capped.
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Kaelen'), entry('Kaelen the Bold')],
      // As the lore manager runs it: applied on the spot, so there is an index to report.
      isAutonomous: true,
      onPendingChange: () => 2,
    })

    const merged = (await tools.merge_entries.execute?.(
      { indices: [0, 1], mergedEntry: entry('Kaelen') } as never,
      {} as never,
    )) as { newIndex?: number; message: string }

    expect(merged.newIndex).toBe(2)
    expect(merged.message).toContain('index 2')
  })

  it('offers no list_chapters: the prompt already carries every summary in full', () => {
    const tools = createLoreManagementTools(context) as unknown as Record<string, unknown>

    expect(tools.list_chapters).toBeUndefined()
    // query_chapter stays — it reads a chapter, it does not restate the list.
    expect(tools.query_chapter).toBeDefined()
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

/** A minimal entry in the shape the tools read. */
const entry = (name: string, aliases: string[] = []) => ({
  name,
  type: 'character' as const,
  description: `About ${name}`,
  keywords: [name],
  aliases,
  injectionMode: 'keyword' as const,
  priority: 50,
})

describe('lore management guards', () => {
  it('refuses to create an entry whose name already exists', async () => {
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Kaelen')],
      preventDuplicateNames: true,
    })

    const result = (await tools.create_entry.execute?.(
      { name: 'kaelen', type: 'character', description: 'again', keywords: [] } as never,
      {} as never,
    )) as { success: boolean; existingIndex?: number }

    expect(result.success).toBe(false)
    expect(result.existingIndex).toBe(0)
  })

  it('matches an existing entry by alias too', async () => {
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Kaelthas', ['Kael'])],
      preventDuplicateNames: true,
    })

    const result = (await tools.create_entry.execute?.(
      { name: 'Kael', type: 'character', description: 'again', keywords: [] } as never,
      {} as never,
    )) as { success: boolean }

    expect(result.success).toBe(false)
  })

  it('creates freely when the guard is off', async () => {
    const tools = createLoreManagementTools({ ...context, entries: [entry('Kaelen')] })

    const result = (await tools.create_entry.execute?.(
      { name: 'Kaelen', type: 'character', description: 'again', keywords: [] } as never,
      {} as never,
    )) as { success: boolean }

    expect(result.success).toBe(true)
  })

  it('does not read two different non-Latin names as the same one', async () => {
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Иван')],
      preventDuplicateNames: true,
    })

    const result = (await tools.create_entry.execute?.(
      { name: 'Пётр', type: 'character', description: 'another', keywords: [] } as never,
      {} as never,
    )) as { success: boolean }

    expect(result.success).toBe(true)
  })

  it('lets a nobiliary particle name through: the refusal must not be lenient', async () => {
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Luca')],
      preventDuplicateNames: true,
    })

    const result = (await tools.create_entry.execute?.(
      { name: 'De Luca', type: 'character', description: 'a different man', keywords: [] } as never,
      {} as never,
    )) as { success: boolean }

    expect(result.success).toBe(true)
  })

  it('refuses to act on a removed index rather than acting on its neighbour', async () => {
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Kaelen'), entry('Mara')],
      removedIndices: new Set([0]),
    })

    const update = (await tools.update_entry.execute?.(
      { index: 0, description: 'edited' } as never,
      {} as never,
    )) as { success: boolean }
    const read = (await tools.read_entry.execute?.({ index: 0 } as never, {} as never)) as {
      found: boolean
    }

    expect(update.success).toBe(false)
    expect(read.found).toBe(false)
  })
})

describe('keep_separate', () => {
  it('closes only a group whose every index the call named', async () => {
    const closed: number[][] = []
    const tools = createLoreManagementTools({
      ...context,
      onKeepSeparate: (indices) => {
        closed.push(indices)
        return indices.length === 2 ? 1 : 0
      },
    })

    const ok = (await tools.keep_separate.execute?.(
      { indices: [0, 1], reason: 'two people' } as never,
      {} as never,
    )) as { acknowledged: boolean; groupsClosed?: number }
    expect(ok).toMatchObject({ acknowledged: true, groupsClosed: 1 })
  })

  it('says so when the indices match no listed group, instead of reading as work done', async () => {
    const tools = createLoreManagementTools({ ...context, onKeepSeparate: () => 0 })

    const result = (await tools.keep_separate.execute?.(
      { indices: [4, 9], reason: 'mistyped' } as never,
      {} as never,
    )) as { acknowledged: boolean; error?: string }

    expect(result.acknowledged).toBe(false)
    expect(result.error).toContain('No listed duplicate group')
  })
})

describe('field normalization', () => {
  it('strips a self-referential alias and a name-repeating keyword on create', async () => {
    let created: { entry?: { aliases: string[]; keywords: string[] } } | undefined
    const tools = createLoreManagementTools({
      ...context,
      onPendingChange: (change) => {
        created = change as typeof created
      },
    })

    const result = (await tools.create_entry.execute?.(
      {
        name: 'Liora',
        type: 'character',
        description: 'A herbalist.',
        keywords: ['Liora', 'The Herbalist', 'poultice'],
        aliases: ['Liora', 'The Herbalist'],
      } as never,
      {} as never,
    )) as { note?: string }

    expect(created?.entry?.aliases).toEqual(['The Herbalist'])
    // 'Liora' repeats the name, 'The Herbalist' repeats an alias, 'poultice' survives.
    expect(created?.entry?.keywords).toEqual(['poultice'])
    expect(result.note).toContain('Liora')
  })

  it('checks an update against the name the entry is about to have', async () => {
    let change: { updates?: { aliases?: string[]; keywords?: string[] } } | undefined
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Pento')],
      onPendingChange: (c) => {
        change = c as typeof change
      },
    })

    await tools.update_entry.execute?.(
      { index: 0, name: 'Lord Vael', aliases: ['Lord Vael', 'Pento'] } as never,
      {} as never,
    )

    // Renamed to its own alias: the alias that became the name goes, the old name stays.
    expect(change?.updates?.aliases).toEqual(['Pento'])
  })

  it('leaves fields the update did not mention untouched', async () => {
    let change: { updates?: Record<string, unknown> } | undefined
    const tools = createLoreManagementTools({
      ...context,
      entries: [entry('Pento', ['Pento'])],
      onPendingChange: (c) => {
        change = c as typeof change
      },
    })

    await tools.update_entry.execute?.({ index: 0, description: 'New text.' } as never, {} as never)

    expect(change?.updates).toEqual({ description: 'New text.' })
  })
})

describe('finish_lore_management', () => {
  const finishArgs = {
    summary: 'done',
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesDeleted: 0,
    entriesMerged: 0,
  }

  it('refuses to complete while a duplicate group is open, then accepts', async () => {
    let open = ['[0] Kaelen | [1] Kaelan']
    const tools = createLoreManagementTools({ ...context, pendingDuplicates: () => open })

    const refused = (await tools.finish_lore_management.execute?.(
      finishArgs as never,
      {} as never,
    )) as { completed: boolean; remainingDuplicates?: string[] }
    expect(refused.completed).toBe(false)
    expect(refused.remainingDuplicates).toEqual(open)

    open = []
    const accepted = (await tools.finish_lore_management.execute?.(
      finishArgs as never,
      {} as never,
    )) as { completed: boolean }
    expect(accepted.completed).toBe(true)
  })

  it('stops refusing after two attempts, so a disagreement cannot burn the run', async () => {
    const tools = createLoreManagementTools({
      ...context,
      pendingDuplicates: () => ['[0] Kaelen | [1] Kaelan'],
    })

    const outcomes = []
    for (let i = 0; i < 3; i++) {
      outcomes.push(
        (await tools.finish_lore_management.execute?.(finishArgs as never, {} as never)) as {
          completed: boolean
        },
      )
    }

    expect(outcomes.map((o) => o.completed)).toEqual([false, false, true])
  })

  it('completes without complaint when nothing is checking duplicates', async () => {
    const tools = createLoreManagementTools(context)

    const result = (await tools.finish_lore_management.execute?.(
      finishArgs as never,
      {} as never,
    )) as { completed: boolean }

    expect(result.completed).toBe(true)
  })
})

describe('list_entries, on the vault assistant that still has it', () => {
  // The factory's return type is the union of "vault only" and "vault plus entry tools",
  // so the entry half is reached the way the tests below already reach it.
  const vaultTools = (entryContext: LorebookEntryToolContext) =>
    createInteractiveVaultLorebookTools(
      { lorebooks: () => [], generateId: () => 'c1' },
      entryContext,
    ) as unknown as Record<string, { execute?: (input: never, options: never) => Promise<unknown> }>

  it('hides a removed entry from the list but keeps the indices of the rest', async () => {
    const tools = vaultTools({
      ...context,
      entries: [entry('Kaelen'), entry('Mara'), entry('Tovin')],
      removedIndices: new Set([1]),
    })

    const result = (await tools.list_entries.execute?.({} as never, {} as never)) as {
      entries: { index: number; name: string }[]
    }

    expect(result.entries.map((e) => e.index)).toEqual([0, 2])
  })

  it('narrows the listing by query, over names, aliases, keywords and descriptions', async () => {
    const tools = vaultTools({
      ...context,
      entries: [
        entry('Kaelen'),
        { ...entry('Mara'), description: 'Serves Kaelen at the forge.' },
        entry('Tovin', ['Kaelen the Younger']),
        entry('Rusthaven'),
      ],
    })

    const result = (await tools.list_entries.execute?.(
      { query: 'Kaelen' } as never,
      {} as never,
    )) as { entries: { index: number }[] }

    expect(result.entries.map((e) => e.index)).toEqual([0, 1, 2])
  })

  it('caps the listing and says there is more', async () => {
    const tools = vaultTools({
      ...context,
      entries: Array.from({ length: 30 }, (_, i) => entry(`Entry ${i}`)),
    })

    const result = (await tools.list_entries.execute?.({ limit: 5 } as never, {} as never)) as {
      availableTotal: number
      returnedCount: number
      hasMore: boolean
    }

    expect(result).toMatchObject({ availableTotal: 30, returnedCount: 5, hasMore: true })
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

  it('keeps lorebookId: there really are several lorebooks to choose between', () => {
    const tools = createInteractiveVaultLorebookTools(
      { lorebooks: () => [], generateId: () => 'c1' },
      context,
    ) as unknown as Record<string, { inputSchema: unknown }>

    expect(inputKeys(tools.list_entries)).toContain('lorebookId')
  })
})
