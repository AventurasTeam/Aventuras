import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import { NARRATIVE_LANE } from './routing'
import { STRUCTURED_SHAPES } from './shapes'

const HERE = dirname(fileURLToPath(import.meta.url))
export const STATE_PATH = join(HERE, 'state.json')

export const FAILURE_KINDS = ['none', 'http', 'stream-cut', 'malformed', 'hang'] as const
export type FailureKind = (typeof FAILURE_KINDS)[number]

const cannedResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  value: z.unknown(),
})

export const laneSchema = z.object({
  mode: z.enum(['mock', 'passthrough']).default('mock'),
  upstreamId: z.string().nullable().default(null),
  responses: z.array(cannedResponseSchema).default([]),
  activeId: z.string().nullable().default(null),
  sequence: z
    .object({
      enabled: z.boolean().default(false),
      ids: z.array(z.string()).default([]),
      cursor: z.number().int().min(0).default(0),
      loop: z.boolean().default(true),
    })
    .prefault({}),
  delay: z
    .object({
      ttfbMs: z.number().int().min(0).max(600_000).default(0),
      jitterMs: z.number().int().min(0).max(60_000).default(0),
    })
    .prefault({}),
  failure: z
    .object({
      kind: z.enum(FAILURE_KINDS).default('none'),
      status: z.number().int().min(400).max(599).default(500),
      /** Calls still to be failed; -1 means always. */
      remaining: z.number().int().min(-1).default(0),
    })
    .prefault({}),
  stream: z
    .object({
      /** 0 delivers the whole reply in one frame. */
      charsPerSecond: z.number().min(0).max(100_000).default(0),
      chunkSize: z.number().int().min(1).max(4096).default(6),
    })
    .prefault({}),
})

export const upstreamSchema = z.object({
  id: z.string(),
  label: z.string(),
  baseURL: z.string(),
  /** Name of the env var holding the key — never the key itself. */
  apiKeyEnv: z.string().default(''),
  model: z.string(),
})

export const mockStateSchema = z.object({
  version: z.literal(1).default(1),
  lanes: z.record(z.string(), laneSchema).default({}),
  upstreams: z.array(upstreamSchema).default([]),
})

export type CannedResponse = z.infer<typeof cannedResponseSchema>
export type Lane = z.infer<typeof laneSchema>
export type Upstream = z.infer<typeof upstreamSchema>
export type MockState = z.infer<typeof mockStateSchema>

function canned(name: string, value: unknown): CannedResponse {
  return { id: `r_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name, value }
}

function lane(responses: CannedResponse[], overrides: Partial<Lane> = {}): Lane {
  return laneSchema.parse({
    responses,
    activeId: responses[0]?.id ?? null,
    sequence: { ids: responses.map((r) => r.id) },
    ...overrides,
  })
}

const NO_STATE_CHANGE = {
  sceneEntities: [],
  worldTimeDelta: 0,
  visualChanges: [],
  transfers: { items: [], stackables: [] },
}

const SAMPLE_SUGGESTIONS = [
  { categoryRef: 'cat1', text: 'You press on toward the sound of the bell.' },
  { categoryRef: 'cat2', text: 'You stop, and let the rain fill the silence.' },
  { categoryRef: 'cat3', text: 'You ask what the bell is for.' },
]

// Entity placeholders (c1, l1, …) are allocated per run in prompt-encounter
// order by IdBiMap, so a shipped default cannot safely name one. Defaults stay
// entity-free; the request log's "author from this request" flow is how you
// write a reply that moves a specific entity.
function defaultLanes(): Record<string, Lane> {
  const lanes: Record<string, Lane> = {
    [NARRATIVE_LANE]: lane(
      [
        canned('Short beat', {
          prose:
            'The blade rasps free of its sheath. Somewhere in the drowned city, a bell answers, and the rain leans closer to listen.',
          state: { worldTimeDelta: 60, summary: 'A blade is drawn; a distant bell answers.' },
        }),
        canned('Long scene', {
          prose: [
            'The water had taken the lower streets weeks ago, and the city had learned to live above itself — rope bridges strung between second-storey windows, doors that opened onto nothing but a green reflection of the sky.',
            '',
            'You come down the stair with one hand on the rail and the other on the hilt. The step gives underfoot, soft as bread. Below, something moves that is not the current.',
            '',
            'The bell sounds again. Closer, this time, and answered by a second somewhere behind you.',
          ].join('\n'),
          state: {
            worldTimeDelta: 900,
            summary: 'A descent through the flooded quarter; two bells answer each other.',
          },
          suggestions: SAMPLE_SUGGESTIONS,
        }),
        canned('With suggestions', {
          prose: 'The rain does not stop. It only changes its mind about direction.',
          state: { worldTimeDelta: 120, summary: 'The storm shifts.' },
          suggestions: SAMPLE_SUGGESTIONS,
        }),
      ],
      { stream: { charsPerSecond: 400, chunkSize: 6 } },
    ),

    'per-turn-classifier': lane([
      canned('No change', NO_STATE_CHANGE),
      canned('Time passes', {
        ...NO_STATE_CHANGE,
        worldTimeDelta: 3600,
        summary: 'An hour goes by.',
      }),
    ]),

    'per-turn-classifier-suggestions': lane([
      canned('No change, three chips', { ...NO_STATE_CHANGE, suggestions: SAMPLE_SUGGESTIONS }),
      canned('No change, no chips', { ...NO_STATE_CHANGE, suggestions: [] }),
    ]),

    // Graph writes reference entity placeholders, which a shipped default
    // cannot know — inert by design, authored per-run from the request log.
    'periodic-classifier': lane([
      canned('Nothing extracted', {
        happenings: [],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
      }),
    ]),

    // A refresh that resolves nothing is a run failure, so the default is not
    // the empty list the other lanes use.
    'suggestion-refresh': lane([canned('Three chips', { suggestions: SAMPLE_SUGGESTIONS })]),
  }

  return lanes
}

export function defaultState(): MockState {
  return mockStateSchema.parse({ lanes: defaultLanes(), upstreams: [] })
}

/** A lane for a shape discovered at runtime that has no configured entry yet. */
export function emptyLane(): Lane {
  return laneSchema.parse({})
}

export function loadState(): MockState {
  let raw: string
  try {
    raw = readFileSync(STATE_PATH, 'utf8')
  } catch {
    return defaultState()
  }
  const parsed = mockStateSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(
      `${STATE_PATH} is not valid mock state — delete it to regenerate defaults.\n${parsed.error.message}`,
    )
  }
  // A state file written before a shape was registered has no lane for it.
  for (const s of STRUCTURED_SHAPES) parsed.data.lanes[s.name] ??= emptyLane()
  parsed.data.lanes[NARRATIVE_LANE] ??= emptyLane()
  return parsed.data
}

let pending: NodeJS.Timeout | undefined

export function saveState(state: MockState): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    pending = undefined
  }, 150)
}

export function flushState(state: MockState): void {
  if (pending) clearTimeout(pending)
  pending = undefined
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * The response this call should serve, advancing the sequence cursor when
 * sequencing is on. Returns null when the lane has nothing configured.
 */
export function nextResponse(lane: Lane): CannedResponse | null {
  const byId = new Map(lane.responses.map((r) => [r.id, r]))

  if (lane.sequence.enabled) {
    const ids = lane.sequence.ids.filter((id) => byId.has(id))
    if (ids.length > 0) {
      const last = ids.length - 1
      // Clamped rather than wrapped when loop is off, so a cursor left out of
      // range by a mid-run edit still resolves to the final entry.
      const index = lane.sequence.loop
        ? lane.sequence.cursor % ids.length
        : Math.min(lane.sequence.cursor, last)
      lane.sequence.cursor = lane.sequence.loop
        ? (index + 1) % ids.length
        : Math.min(index + 1, last)
      return byId.get(ids[index] as string) ?? null
    }
  }

  if (lane.activeId !== null && byId.has(lane.activeId)) return byId.get(lane.activeId) ?? null
  return lane.responses[0] ?? null
}

/** Whether this call should fail, decrementing a finite countdown. */
export function takeFailure(lane: Lane): FailureKind {
  if (lane.failure.kind === 'none') return 'none'
  if (lane.failure.remaining === 0) return 'none'
  if (lane.failure.remaining > 0) lane.failure.remaining -= 1
  return lane.failure.kind
}
