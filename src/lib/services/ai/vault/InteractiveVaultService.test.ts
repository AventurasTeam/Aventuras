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
vi.mock('$lib/stores/activity.svelte', () => ({
  activity: {
    startStep: vi.fn(() => ''),
    updateStep: vi.fn(),
    endStep: vi.fn(),
    recordStep: vi.fn(() => ''),
  },
}))
vi.mock('$lib/stores/debug.svelte', () => ({
  debug: { log: vi.fn(), isActive: false },
}))

// In-memory fake mirroring the real DB's semantics (see database.ts): create()
// inserts a full row, save() does a partial column update on an existing row.
const conversationRows = new Map<string, Record<string, unknown>>()
vi.mock('$lib/services/database', () => ({
  database: {
    // Null makes ContextBuilder fall back to the built-in templates, so these tests render
    // the real interactive-lorebook prompt.
    getPackTemplate: vi.fn(async () => null),
    getPackVariables: vi.fn(async () => []),
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
// completing normally (e.g. an aborted fetch). A function is awaited once the
// factory has captured the tools, so a test can run the real tool executes first.
let nextStreamEvents: unknown[] | ((tools: Record<string, any>) => Promise<unknown[]>) = []
let nextStreamError: Error | null = null
// Captures the options (tools, prepareStep, ...) passed to the factory on the
// most recent call, so tests can exercise the load_toolset tool and prepareStep
// directly instead of only the pure getActiveToolNames helper.
let lastCreateOptions: {
  tools: Record<string, any>
  prepareStep: () => unknown
  instructions: string
} | null = null

vi.mock('../sdk/agents/factory', () => ({
  createStreamingAgenticAssistant: vi.fn((options: any) => {
    lastCreateOptions = options
    return {
      stream: vi.fn(async () => ({
        fullStream: (async function* () {
          const script = nextStreamEvents
          const events = typeof script === 'function' ? await script(options.tools) : script
          for (const event of events) yield event
          if (nextStreamError) throw nextStreamError
        })(),
        response: Promise.resolve({ messages: [] }),
      })),
    }
  }),
}))

const { InteractiveVaultService, getActiveToolNames, TOOL_CATEGORIES, ALWAYS_ACTIVE_TOOLS } =
  await import('./InteractiveVaultService')
const { database } = await import('$lib/services/database')
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
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary)
    expect(service.loadedCategories.size).toBe(0)
  })

  it('pre-loads the matching category when opened from an entity editor', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, {
      entityType: 'character',
      entityId: 'char-1',
      entityName: 'Alice',
    })
    expect([...service.loadedCategories]).toEqual(['characters'])
  })

  it('clears previously loaded categories on re-initialize', async () => {
    const service = new InteractiveVaultService('interactiveVault')
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

describe('focused entity context', () => {
  const alice = {
    id: 'char-1',
    name: 'Alice',
    description: 'A thief',
    traits: ['sly'],
    visualDescriptors: {},
    tags: [],
    favorite: false,
    source: 'manual',
    portrait: 'data:image/png;base64,SECRET',
  }
  const focusOnAlice = {
    entityType: 'character' as const,
    entityId: 'char-1',
    entityName: 'Alice',
  }

  function stateWith(overrides: Partial<VaultState>): VaultState {
    return { ...emptyVaultState(), ...overrides }
  }

  async function send(service: InstanceType<typeof InteractiveVaultService>, state: VaultState) {
    for await (const _ of service.sendMessageStreaming(state, 'make her taller')) {
      // drain
    }
  }

  const userMessages = (service: InstanceType<typeof InteractiveVaultService>) =>
    service
      .getConversationHistory()
      .filter((m) => m.role === 'user')
      .map((m) => m.content as string)

  it('adds no Active Context and sends the raw message without a focus', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary)
    await send(service, stateWith({ characters: () => [alice as never] }))

    expect(lastCreateOptions!.instructions).not.toContain('Active Context')
    expect(userMessages(service)).toEqual(['make her taller'])
  })

  it('names the entity in the system prompt and puts its record in the first user turn', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    await send(service, stateWith({ characters: () => [alice as never] }))

    expect(lastCreateOptions!.instructions).toContain('## Active Context')
    expect(lastCreateOptions!.instructions).toContain('"Alice" (ID: `char-1`)')
    expect(lastCreateOptions!.instructions).not.toContain('"sly"')

    const [first] = userMessages(service)
    expect(first).toContain('"name": "Alice"')
    expect(first).toContain('"sly"')
    expect(first).not.toContain('SECRET')
    expect(first.endsWith('make her taller')).toBe(true)
  })

  it('does not repeat an unchanged record and leaves the system prompt alone', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    const state = stateWith({ characters: () => [alice as never] })

    await send(service, state)
    const firstInstructions = lastCreateOptions!.instructions
    await send(service, state)

    expect(lastCreateOptions!.instructions).toBe(firstInstructions)
    expect(userMessages(service)[1]).toBe('make her taller')
  })

  it('sends the record again, leaving earlier turns untouched, once it changes', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    let current = alice

    const state = stateWith({ characters: () => [current as never] })
    await send(service, state)
    const [first] = userMessages(service)

    current = { ...alice, traits: ['sly', 'tall'] }
    await send(service, state)

    const messages = userMessages(service)
    expect(messages[0]).toBe(first)
    expect(messages[1]).toContain('"tall"')
    expect(messages[1].endsWith('make her taller')).toBe(true)
  })

  it('keeps the record unsent when rendering the turn fails', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    const state = stateWith({ characters: () => [alice as never] })

    vi.mocked(database.getPackTemplate).mockRejectedValueOnce(new Error('db unavailable'))
    const events: unknown[] = []
    for await (const event of service.sendMessageStreaming(state, 'make her taller')) {
      events.push(event)
    }
    expect(events).toEqual([{ type: 'error', error: 'db unavailable' }])
    expect(userMessages(service)).toEqual([])

    await send(service, state)
    expect(userMessages(service)[0]).toContain('"name": "Alice"')
  })

  it('names the entity but sends no record when it is no longer in the vault', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    await send(service, emptyVaultState())

    expect(lastCreateOptions!.instructions).toContain('## Active Context')
    expect(userMessages(service)).toEqual(['make her taller'])
  })

  it('summarises a focused lorebook without its entries', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, {
      entityType: 'lorebook',
      entityId: 'lb-1',
      entityName: 'Realm',
    })
    const lorebook = {
      id: 'lb-1',
      name: 'Realm',
      description: 'A world',
      tags: ['realm'],
      entries: [{ name: 'Secret Entry' }, { name: 'Another' }],
    }
    await send(service, stateWith({ lorebooks: () => [lorebook as never] }))

    const [first] = userMessages(service)
    expect(first).toContain('"entryCount": 2')
    expect(first).toContain('"realm"')
    expect(first).not.toContain('Secret Entry')
  })

  it('drops the focus when a saved conversation is loaded', async () => {
    const writer = new InteractiveVaultService('interactiveVault')
    const id = await writer.saveConversation(
      [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      [],
    )

    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    await service.loadConversation(id)
    await send(service, stateWith({ characters: () => [alice as never] }))

    expect(service.getFocusedEntity()).toBeNull()
    expect(lastCreateOptions!.instructions).not.toContain('Active Context')
    expect(userMessages(service).at(-1)).toBe('make her taller')
  })

  it('drops the toolset seeded from the focus when a saved conversation is loaded', async () => {
    const writer = new InteractiveVaultService('interactiveVault')
    const id = await writer.saveConversation(
      [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      [],
    )

    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary, focusOnAlice)
    expect(service.loadedCategories.has('characters')).toBe(true)

    await service.loadConversation(id)
    expect(service.loadedCategories.size).toBe(0)
  })
})

describe('saveConversation / loadConversation', () => {
  it('creates a new conversation with an auto-generated, truncated title', async () => {
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
    const id = await service.saveConversation(
      [{ id: 'm1', role: 'user', content: '[System: approved]', timestamp: 1 }],
      [],
    )
    expect(conversationRows.get(id)!.title).toBe('New Conversation')
  })

  it('reuses the same conversation id on subsequent saves (update, not re-create)', async () => {
    const service = new InteractiveVaultService('interactiveVault')
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
    const writer = new InteractiveVaultService('interactiveVault')
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

    const reader = new InteractiveVaultService('interactiveVault')
    const loaded = await reader.loadConversation(id)

    expect(loaded).not.toBeNull()
    expect(loaded!.chatMessages).toHaveLength(1)
    expect(loaded!.chatMessages[0].content).toBe('make a character')
    expect(loaded!.pendingChanges).toHaveLength(1)
    expect(loaded!.pendingChanges[0].id).toBe('pc-1')
    expect(reader.getConversationId()).toBe(id)
  })

  it('returns null for a conversation id that does not exist', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    expect(await service.loadConversation('does-not-exist')).toBeNull()
  })
})

describe('sendMessageStreaming', () => {
  it('errors immediately if called before initialize()', async () => {
    const service = new InteractiveVaultService('interactiveVault')
    const events = []
    for await (const event of service.sendMessageStreaming(emptyVaultState(), 'hi')) {
      events.push(event)
    }
    expect(events).toEqual([
      { type: 'error', error: 'Service not initialized. Call initialize() first.' },
    ])
  })

  it('streams text deltas and yields a final message, then done', async () => {
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
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
    const service = new InteractiveVaultService('interactiveVault')
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

describe('sendMessageStreaming pending changes from parallel tool calls', () => {
  type Call = { id: string; name: string; args: Record<string, unknown> }

  // The SDK runs a step's tool calls together once the model call ends, so every change exists
  // before the first tool-result is emitted. Both orders are indices into `calls`: the order the
  // tools run in, and the order their results arrive in.
  function parallelStep(
    calls: Call[],
    {
      executeOrder = calls.map((_, i) => i),
      resultOrder = calls.map((_, i) => i),
    }: {
      executeOrder?: number[]
      resultOrder?: number[]
    } = {},
  ) {
    return async (tools: Record<string, any>) => {
      const outputs: unknown[] = []
      for (const i of executeOrder)
        outputs[i] = await tools[calls[i].name].execute(calls[i].args, {})
      return [
        { type: 'start-step' },
        ...calls.map((c) => ({
          type: 'tool-call',
          toolCallId: c.id,
          toolName: c.name,
          input: c.args,
        })),
        ...resultOrder.map((i) => ({
          type: 'tool-result',
          toolCallId: calls[i].id,
          output: outputs[i],
        })),
        { type: 'finish-step' },
      ]
    }
  }

  const character = (id: string) =>
    ({
      id,
      name: `Char ${id}`,
      description: '',
      traits: [],
      visualDescriptors: {},
      tags: [],
      favorite: false,
      portrait: null,
    }) as never

  const entry = (name: string) => ({
    name,
    type: 'character' as const,
    description: `About ${name}`,
    keywords: [name.toLowerCase()],
    aliases: [],
    injectionMode: 'keyword' as const,
    priority: 50,
  })

  const entries = [entry('Ann'), entry('Bob')] as never[]
  const lorebookState = (): VaultState => ({
    ...emptyVaultState(),
    lorebooks: () => [{ id: 'lb1', name: 'Book', entries } as never],
    activeLorebookId: 'lb1',
    activeEntries: entries,
  })
  const characterState = (): VaultState => ({
    ...emptyVaultState(),
    characters: () => [character('c1'), character('c2')],
  })

  async function newService() {
    const service = new InteractiveVaultService('interactiveVault')
    await service.initialize(emptySummary)
    return service
  }

  async function run(state: VaultState, service?: InstanceType<typeof InteractiveVaultService>) {
    const events: any[] = []
    for await (const event of (service ?? (await newService())).sendMessageStreaming(state, 'go')) {
      events.push(event)
    }
    return events
  }

  const pendingChangesOf = (events: any[]) =>
    events.filter((e) => e.type === 'tool_end').map((e) => e.toolCall.pendingChange)
  const stepMessage = (events: any[]) => events.find((e) => e.type === 'message').message

  // Run order, creation order and result order all differ, and neither a queue (in order) nor a
  // stack (reversed) reproduces the result order, so only linking by id passes.
  it('links each call to its own change whatever order the calls run and report in', async () => {
    const service = await newService()
    service.generatedImages.set('img-1', 'data:image/png;base64,AAAA')
    nextStreamEvents = parallelStep(
      [
        { id: 'call-1', name: 'update_entry', args: { index: 0, description: 'new Ann' } },
        { id: 'call-2', name: 'update_entry', args: { index: 1, description: 'new Bob' } },
        { id: 'call-3', name: 'set_portrait', args: { characterId: 'c1', imageId: 'img-1' } },
      ],
      { executeOrder: [1, 2, 0], resultOrder: [2, 0, 1] },
    )

    const events = await run(fullState(), service)

    const ended = events.filter((e) => e.type === 'tool_end').map((e) => e.toolCall)
    expect(ended.map((t) => t.id)).toEqual(['call-3', 'call-1', 'call-2'])
    expect(Object.fromEntries(ended.map((t) => [t.id, t.pendingChange]))).toEqual({
      'call-1': expect.objectContaining({ action: 'update', entryIndex: 0 }),
      'call-2': expect.objectContaining({ action: 'update', entryIndex: 1 }),
      'call-3': expect.objectContaining({ action: 'update', entityId: 'c1' }),
    })
    expect(stepMessage(events).pendingChanges).toHaveLength(3)
    expect(events.find((e) => e.type === 'done').result.unlinkedChangeIds).toEqual([])
  })

  it('gives a failed call no change when a sibling call succeeded', async () => {
    nextStreamEvents = parallelStep([
      { id: 'call-1', name: 'update_entry', args: { index: 99, description: 'nope' } },
      { id: 'call-2', name: 'update_entry', args: { index: 1, description: 'new Bob' } },
    ])

    const events = await run(lorebookState())

    const [failed, succeeded] = pendingChangesOf(events)
    expect(failed).toBeUndefined()
    expect(succeeded).toMatchObject({ action: 'update', entryIndex: 1 })
  })

  const scenario = () =>
    ({
      id: 's1',
      name: 'Scenario',
      description: null,
      settingSeed: 'A seed',
      npcs: [{ name: 'Npc', role: 'guard', description: '', relationship: '', traits: [] }],
      primaryCharacterName: 'Hero',
      firstMessage: null,
      alternateGreetings: [],
      tags: [],
      favorite: false,
    }) as never
  const scenarioState = (): VaultState => ({
    ...emptyVaultState(),
    scenarios: () => [scenario()],
  })
  const fullState = (): VaultState => ({
    ...lorebookState(),
    characters: characterState().characters,
    scenarios: scenarioState().scenarios,
  })

  const npc = {
    name: 'Gate',
    role: 'guard',
    description: 'Watches',
    relationship: 'foe',
    traits: [],
  }

  // Every tool that creates a pending change, with a state and args that make it succeed.
  // A tool that creates a change must carry it (or its id) on its result.
  const CHANGE_TOOLS: {
    name: string
    state: () => VaultState
    args: Record<string, unknown>
    seed?: (service: InstanceType<typeof InteractiveVaultService>) => void
  }[] = [
    {
      name: 'create_character',
      state: characterState,
      args: {
        name: 'New',
        description: null,
        traits: [],
        visualDescriptors: {},
      },
    },
    {
      name: 'update_character',
      state: characterState,
      args: { characterId: 'c1', name: 'Renamed' },
    },
    { name: 'delete_character', state: characterState, args: { characterId: 'c1' } },
    {
      name: 'create_scenario',
      state: scenarioState,
      args: {
        name: 'New',
        description: null,
        settingSeed: 'Seed',
        primaryCharacterName: 'Hero',
      },
    },
    { name: 'update_scenario', state: scenarioState, args: { scenarioId: 's1', name: 'Renamed' } },
    { name: 'delete_scenario', state: scenarioState, args: { scenarioId: 's1' } },
    { name: 'add_scenario_npc', state: scenarioState, args: { scenarioId: 's1', npc } },
    {
      name: 'update_scenario_npc',
      state: scenarioState,
      args: { scenarioId: 's1', npcName: 'Npc', updates: { role: 'captain' } },
    },
    {
      name: 'remove_scenario_npc',
      state: scenarioState,
      args: { scenarioId: 's1', npcName: 'Npc' },
    },
    { name: 'create_lorebook', state: lorebookState, args: { name: 'New book' } },
    {
      name: 'create_entry',
      state: lorebookState,
      args: {
        name: 'Cy',
        type: 'character',
        description: 'About Cy',
        keywords: ['cy'],
      },
    },
    { name: 'update_entry', state: lorebookState, args: { index: 0, description: 'new Ann' } },
    { name: 'delete_entry', state: lorebookState, args: { index: 0 } },
    {
      name: 'merge_entries',
      state: lorebookState,
      args: { indices: [0, 1], mergedEntry: entry('Merged') },
    },
    {
      name: 'link_character_to_lorebook',
      state: fullState,
      args: { characterId: 'c1', lorebookId: 'lb1' },
    },
    {
      name: 'create_lorebook_entry_from_character',
      state: fullState,
      args: { characterId: 'c1', lorebookId: 'lb1' },
    },
    {
      name: 'set_portrait',
      state: characterState,
      args: { characterId: 'c1', imageId: 'img-1' },
      seed: (service) => service.generatedImages.set('img-1', 'data:image/png;base64,AAAA'),
    },
  ]

  const NO_CHANGE_TOOLS = [
    'fetch_fandom_section',
    'generate_portrait',
    'generate_standard_image',
    'get_fandom_article_info',
    'list_characters',
    'list_entries',
    'list_lorebooks',
    'list_scenarios',
    'load_toolset',
    'read_character',
    'read_entry',
    'read_lorebook_summary',
    'read_scenario',
    'search_fandom',
    'show_entity',
  ]

  it('classifies every registered tool as creating a change or not', async () => {
    await run(emptyVaultState())

    expect(Object.keys(lastCreateOptions!.tools).sort()).toEqual(
      [...CHANGE_TOOLS.map((t) => t.name), ...NO_CHANGE_TOOLS].sort(),
    )
  })

  it.each(CHANGE_TOOLS)('$name carries its change on the tool result', async (row) => {
    const service = await newService()
    row.seed?.(service)
    nextStreamEvents = parallelStep([{ id: 'call-1', name: row.name, args: row.args }])

    const events = await run(row.state(), service)

    expect(pendingChangesOf(events)).toEqual([expect.objectContaining({ id: expect.any(String) })])
    expect(stepMessage(events).pendingChanges).toHaveLength(1)
    expect(events.find((e) => e.type === 'done').result.unlinkedChangeIds).toEqual([])
  })

  it('reports a change that no tool result carried', async () => {
    nextStreamEvents = async (tools) => {
      const output = await tools.delete_character.execute({ characterId: 'c1' }, {})
      const { pendingChange: _dropped, ...withoutChange } = output
      return [
        { type: 'start-step' },
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'delete_character',
          input: { characterId: 'c1' },
        },
        { type: 'tool-result', toolCallId: 'call-1', output: withoutChange },
        { type: 'finish-step' },
      ]
    }

    const events = await run(characterState())

    const { result } = events.find((e) => e.type === 'done')
    expect(result.pendingChanges).toHaveLength(1)
    expect(result.unlinkedChangeIds).toEqual([result.pendingChanges[0].id])
    expect(pendingChangesOf(events)).toEqual([undefined])
  })
})
