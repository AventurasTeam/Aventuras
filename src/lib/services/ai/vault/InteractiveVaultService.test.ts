/**
 * Tests for InteractiveVaultService: dynamic tool-category loading, conversation
 * save/load, and the sendMessageStreaming event translation layer (including the
 * abort-vs-error distinction fixed alongside this test suite).
 *
 * The AI SDK call itself (createStreamingAgenticAssistant) is mocked so each test
 * controls exactly which fullStream parts are emitted — this exercises the
 * service's own event handling, not the underlying agent loop or the individual
 * vault tool factories (those would need their own dedicated tests).
 *
 * Rune-based stores (settings.svelte, characterVault.svelte, ...) are mocked
 * because vitest.config.ts deliberately runs plain node, without the Svelte
 * preprocessor — importing them for real would fail on the bare `$state()` calls.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: {
    getPresetConfig: vi.fn(() => ({ model: 'test-model' })),
    getServicePresetId: vi.fn(() => 'test-preset'),
  },
}))

vi.mock('$lib/stores/characterVault.svelte', () => ({
  characterVault: { items: [], getById: vi.fn() },
}))

vi.mock('$lib/stores/lorebookVault.svelte', () => ({
  lorebookVault: { items: [], getById: vi.fn(), getEntryVersion: vi.fn(() => 0) },
}))

vi.mock('$lib/stores/scenarioVault.svelte', () => ({
  scenarioVault: { items: [], getById: vi.fn() },
}))

// Pulled in transitively via BaseAIService -> sdk/generate, unused by the paths
// under test here (they never call this.generate()).
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { log: vi.fn(), isActive: false },
}))

// In-memory fake mirroring the real DB's semantics (see database.ts): create()
// inserts a full row, save() does a partial column update on an existing row.
const conversationRows = new Map<string, Record<string, unknown>>()
vi.mock('$lib/services/database', () => ({
  database: {
    getPackTemplate: vi.fn(async () => ({ content: 'Vault assistant for {{characterCount}}.' })),
    createVaultConversation: vi.fn(async (c: Record<string, unknown>) => {
      conversationRows.set(c.id as string, { ...c })
    }),
    saveVaultConversation: vi.fn(async (id: string, updates: Record<string, unknown>) => {
      const row = conversationRows.get(id)
      if (!row) return
      Object.assign(row, updates)
    }),
    loadVaultConversation: vi.fn(async (id: string) => conversationRows.get(id) ?? null),
  },
}))

// Each test sets these before calling sendMessageStreaming to script the fake
// agent's fullStream. nextStreamError simulates the stream throwing instead of
// completing normally (e.g. an aborted fetch).
let nextStreamEvents: unknown[] = []
let nextStreamError: Error | null = null
// Captures the options (tools, prepareStep, ...) passed to the factory on the
// most recent call, so tests can exercise the load_toolset tool and prepareStep
// directly instead of only the pure getActiveToolNames helper.
let lastCreateOptions: { tools: Record<string, any>; prepareStep: () => unknown } | null = null

vi.mock('../sdk/agents/factory', () => ({
  createStreamingAgenticAssistant: vi.fn((options: any) => {
    lastCreateOptions = options
    return {
      stream: vi.fn(async () => ({
        fullStream: (async function* () {
          for (const event of nextStreamEvents) yield event
          if (nextStreamError) throw nextStreamError
        })(),
        response: Promise.resolve({ messages: [] }),
      })),
    }
  }),
}))

const { InteractiveVaultService, getActiveToolNames, TOOL_CATEGORIES, ALWAYS_ACTIVE_TOOLS } =
  await import('./InteractiveVaultService')
type VaultState = import('./InteractiveVaultService').VaultState
type VaultSummary = import('./InteractiveVaultService').VaultSummary
type ToolCategory = import('./InteractiveVaultService').ToolCategory

beforeEach(() => {
  conversationRows.clear()
  nextStreamEvents = []
  nextStreamError = null
  lastCreateOptions = null
})

afterEach(() => {
  vi.clearAllMocks()
})

function emptyVaultState(): VaultState {
  return {
    characters: () => [],
    lorebooks: () => [],
    scenarios: () => [],
  }
}

const emptySummary: VaultSummary = {
  characterCount: 0,
  lorebookCount: 0,
  totalEntryCount: 0,
  scenarioCount: 0,
}

describe('getActiveToolNames', () => {
  it('always includes the always-active tools, even with nothing loaded', () => {
    expect(getActiveToolNames(new Set())).toEqual(ALWAYS_ACTIVE_TOOLS)
  })

  it('adds every tool from a loaded category', () => {
    const names = getActiveToolNames(new Set<ToolCategory>(['characters']))
    for (const tool of TOOL_CATEGORIES.characters) {
      expect(names).toContain(tool)
    }
    for (const tool of TOOL_CATEGORIES.scenarios) {
      expect(names).not.toContain(tool)
    }
  })

  it('merges tools from multiple loaded categories', () => {
    const names = getActiveToolNames(new Set<ToolCategory>(['characters', 'images']))
    expect(names).toEqual([
      ...ALWAYS_ACTIVE_TOOLS,
      ...TOOL_CATEGORIES.characters,
      ...TOOL_CATEGORIES.images,
    ])
  })
})

describe('initialize', () => {
  it('starts with no categories loaded when opened with no focused entity', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)
    expect(service.loadedCategories.size).toBe(0)
  })

  it('pre-loads the matching category when opened from an entity editor', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary, {
      entityType: 'character',
      entityId: 'char-1',
      entityName: 'Alice',
    })
    expect([...service.loadedCategories]).toEqual(['characters'])
  })

  it('clears previously loaded categories on re-initialize', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary, {
      entityType: 'scenario',
      entityId: 's-1',
      entityName: 'Quest',
    })
    expect(service.loadedCategories.has('scenarios')).toBe(true)
    await service.initialize(emptySummary)
    expect(service.loadedCategories.size).toBe(0)
  })
})

describe('saveConversation / loadConversation', () => {
  it('creates a new conversation with an auto-generated, truncated title', async () => {
    const service = new InteractiveVaultService('vault-test')
    const longMessage =
      'Please help me build out a whole new fantasy kingdom with a dozen NPCs and lore'
    const id = await service.saveConversation(
      [
        { id: 'm1', role: 'user', content: longMessage, timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'Sure!', timestamp: 2 },
      ],
      [],
    )

    expect(service.getConversationId()).toBe(id)
    const row = conversationRows.get(id)
    expect(row).toBeDefined()
    expect((row!.title as string).length).toBeLessThanOrEqual(53) // 50 chars + '...'
    expect(longMessage.startsWith(row!.title as string)).toBe(false) // truncated at word boundary
    expect(row!.title).toMatch(/\.\.\.$/)
  })

  it('falls back to "New Conversation" when the first message is only a system note', async () => {
    const service = new InteractiveVaultService('vault-test')
    const id = await service.saveConversation(
      [{ id: 'm1', role: 'user', content: '[System: approved]', timestamp: 1 }],
      [],
    )
    expect(conversationRows.get(id)!.title).toBe('New Conversation')
  })

  it('reuses the same conversation id on subsequent saves (update, not re-create)', async () => {
    const service = new InteractiveVaultService('vault-test')
    const id1 = await service.saveConversation(
      [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
      [],
    )
    const id2 = await service.saveConversation(
      [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'hi!', timestamp: 2 },
      ],
      [],
    )
    expect(id2).toBe(id1)
    expect(conversationRows.size).toBe(1)
    const chatMessages = JSON.parse(conversationRows.get(id1)!.chatMessages as string)
    expect(chatMessages).toHaveLength(2)
  })

  it('round-trips chat messages and pending changes through save/load', async () => {
    const writer = new InteractiveVaultService('vault-test')
    const pendingChange = {
      id: 'pc-1',
      toolCallId: 'call-1',
      entityType: 'character' as const,
      action: 'create' as const,
      status: 'pending' as const,
      data: { name: 'Alice' },
    }
    const id = await writer.saveConversation(
      [{ id: 'm1', role: 'user', content: 'make a character', timestamp: 1 }],
      [pendingChange as never],
    )

    const reader = new InteractiveVaultService('vault-test')
    const loaded = await reader.loadConversation(id)

    expect(loaded).not.toBeNull()
    expect(loaded!.chatMessages).toHaveLength(1)
    expect(loaded!.chatMessages[0].content).toBe('make a character')
    expect(loaded!.pendingChanges).toHaveLength(1)
    expect(loaded!.pendingChanges[0].id).toBe('pc-1')
    expect(reader.getConversationId()).toBe(id)
  })

  it('returns null for a conversation id that does not exist', async () => {
    const service = new InteractiveVaultService('vault-test')
    expect(await service.loadConversation('does-not-exist')).toBeNull()
  })
})

describe('sendMessageStreaming', () => {
  it('errors immediately if called before initialize()', async () => {
    const service = new InteractiveVaultService('vault-test')
    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      events.push(event)
    }
    expect(events).toEqual([
      { type: 'error', error: 'Service not initialized. Call initialize() first.' },
    ])
  })

  it('streams text deltas and yields a final message, then done', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [
      { type: 'start-step' },
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo!' },
      { type: 'finish-step' },
    ]

    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo!' },
      {
        type: 'message',
        message: expect.objectContaining({ role: 'assistant', content: 'Hello!' }),
      },
      {
        type: 'done',
        result: expect.objectContaining({ response: 'Hello!' }),
      },
    ])
  })

  it('emits tool_start/tool_end for a tool call step', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [
      { type: 'start-step' },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'list_characters',
        input: { foo: 'bar' },
      },
      { type: 'tool-result', toolCallId: 'call-1', output: { characters: [] } },
      { type: 'finish-step' },
    ]

    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'list them')) {
      events.push(event)
    }

    const toolStart = events.find((e) => e.type === 'tool_start')
    const toolEnd = events.find((e) => e.type === 'tool_end')
    expect(toolStart).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'list_characters',
      args: { foo: 'bar' },
    })
    expect(toolEnd).toMatchObject({ toolCall: { id: 'call-1', name: 'list_characters' } })
  })

  it('yields a single "aborted" event when the underlying stream is cancelled by the user', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [{ type: 'start-step' }, { type: 'text-delta', text: 'partial' }]
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    nextStreamError = abortError

    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      events.push(event)
    }

    // A partial text_delta may have already streamed before the abort landed,
    // but there must be exactly one terminal event, and it must be 'aborted' —
    // never a generic 'error' bubble for a user-initiated stop.
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
    expect(events.at(-1)).toEqual({ type: 'aborted' })
  })

  it('yields "aborted" even when the underlying runtime throws a non-Error abort value', async () => {
    // Reproduces a real bug: in Tauri's WebKit-based webview, an aborted fetch
    // can reject with a value that isn't `instanceof Error` at all, so relying
    // on `error instanceof Error && error.name === 'AbortError'` alone missed
    // it and fell through to a generic "Unknown error" bubble. The service
    // must also trust `signal.aborted` regardless of what shape the thrown
    // value has.
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [{ type: 'start-step' }]
    nextStreamError = { name: 'AbortError', message: 'aborted' } as unknown as Error

    const controller = new AbortController()
    controller.abort()

    const events = []
    for await (const event of service.sendMessageStreaming(
      emptyVaultState(),
      'hi',
      controller.signal,
    )) {
      events.push(event)
    }

    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
    expect(events.at(-1)).toEqual({ type: 'aborted' })
  })

  it('yields "aborted" when the SDK emits a native abort stream part (no thrown error)', async () => {
    // The AI SDK can signal cancellation as a fullStream part rather than
    // throwing. Without a dedicated case for it, this part would fall through
    // the switch unhandled, the loop would end normally, and the caller would
    // see a 'done' event as if the response had actually completed.
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [
      { type: 'start-step' },
      { type: 'text-delta', text: 'partial' },
      { type: 'abort', reason: 'user requested cancellation' },
    ]

    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      events.push(event)
    }

    expect(events.filter((e) => e.type === 'error' || e.type === 'done')).toHaveLength(0)
    expect(events.at(-1)).toEqual({ type: 'aborted' })
  })

  it('still yields a normal error event for a real (non-abort) failure', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [{ type: 'start-step' }]
    nextStreamError = new Error('model provider is down')

    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      events.push(event)
    }

    expect(events.at(-1)).toEqual({ type: 'error', error: 'model provider is down' })
  })

  it('load_toolset updates the activeTools prepareStep exposes for the next step', async () => {
    const service = new InteractiveVaultService('vault-test')
    await service.initialize(emptySummary)

    nextStreamEvents = [{ type: 'start-step' }, { type: 'finish-step' }]
    for await (const _event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      // Draining the generator is enough to reach the createStreamingAgenticAssistant
      // call and capture its options — nothing to assert per-event here.
    }

    expect(lastCreateOptions).not.toBeNull()
    const loadToolset = lastCreateOptions!.tools.load_toolset
    expect(loadToolset).toBeDefined()

    await loadToolset.execute({ categories: ['characters', 'images'] })

    const activeTools = (lastCreateOptions!.prepareStep() as { activeTools: string[] }).activeTools
    for (const name of ALWAYS_ACTIVE_TOOLS) expect(activeTools).toContain(name)
    for (const name of TOOL_CATEGORIES.characters) expect(activeTools).toContain(name)
    for (const name of TOOL_CATEGORIES.images) expect(activeTools).toContain(name)
    for (const name of TOOL_CATEGORIES.scenarios) expect(activeTools).not.toContain(name)
  })
})
