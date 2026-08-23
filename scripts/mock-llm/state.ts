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

    ...wizardLanes(),
  }

  return lanes
}

const DROWNED_CITY_GENRE = [
  'Write drowned-city fantasy: a world where the water came and stayed, and people built upward rather than leaving. Magic is old infrastructure — half-understood, still running, and expensive to touch.',
  '',
  'Keep the fantastic domestic. A ward that keeps a doorway dry is worth more than a prophecy, and characters argue about who pays for it. Name the trades, the tolls and the tide tables; let wonder arrive through what people do for a living.',
].join('\n')

const DROWNED_CITY_TONE = [
  'Write in a wry, elegiac register. The narration has seen worse and says so plainly; grief arrives sideways, in an inventory or a joke, rather than in a declaration.',
  '',
  'Favour short declaratives at the moment of action and longer, looser sentences either side of it. Cut adverbs, cut weather-as-mood unless the weather is doing something. Let a scene end one beat before the reader expects it to.',
].join('\n')

const DROWNED_CITY_SETTING =
  'Vessel was a river port before the sea reached inland and made it an archipelago of its own rooftops. Two centuries on, the lower streets are shipping lanes, the guild halls have docks where their front steps used to be, and the tide is a municipal department.\n\nWhat kept the city alive was the ward-work in its foundations, laid by engineers nobody can now name. It still holds. Nobody knows for how long, and the people who ask loudest are the ones who have read the maintenance ledgers.'

const OPENING_PROSE =
  'The blade rasps free of its sheath. Somewhere in the drowned city a bell answers, and the rain leans closer to listen.\n\nYou come down the stair with one hand on the rail. The step gives underfoot, soft as bread, and below you something moves that is not the current.'

const OPENING_PROSE_REFINED =
  'The blade comes free without a sound — you have had practice — and the bell answers anyway, somewhere east, muffled by rain.\n\nThe stair takes your weight in the grudging way rotted wood does. Two steps from the bottom the water starts. Something in it moves against the current, unhurried, as though it has all evening.'

// sceneEntities and currentLocationId stay empty for the same reason the
// classifier defaults write nothing: IdBiMap allocates c1/l1 per run in
// prompt-encounter order, so a shipped default cannot know what they point at.
// The request log's "Open this lane with its placeholders" is how a reply that
// tags a specific entity gets written.
function opening(prose: string): Record<string, unknown> {
  return { prose, sceneEntities: [], currentLocationId: null, worldTime: 0 }
}

function labeled(label: string, promptBody: string): Record<string, unknown> {
  return { label, promptBody }
}

function wizardLanes(): Record<string, Lane> {
  return {
    'wizard-genre': lane([
      canned('Drowned-city fantasy', labeled('Drowned-city fantasy', DROWNED_CITY_GENRE)),
    ]),
    'wizard-genre-refine': lane([
      canned(
        'Drowned-city fantasy, grimmer',
        labeled(
          'Drowned-city salvage fantasy',
          `${DROWNED_CITY_GENRE}\n\nThe salvage trade is the spine of it. Everything of value was somebody's before the water, and the law about that is unsettled enough to be worth killing over.`,
        ),
      ),
    ]),

    'wizard-tone': lane([canned('Wry and elegiac', labeled('Wry and elegiac', DROWNED_CITY_TONE))]),
    'wizard-tone-refine': lane([
      canned(
        'Wry and elegiac, drier',
        labeled(
          'Dry and elegiac',
          `${DROWNED_CITY_TONE}\n\nPull the sentiment back another notch. Where a line could be either bitter or fond, write it fond and let the context supply the bitterness.`,
        ),
      ),
    ]),

    'wizard-setting': lane([canned('Vessel', { setting: DROWNED_CITY_SETTING })]),
    'wizard-setting-refine': lane([
      canned('Vessel, with the tide court', {
        setting: `${DROWNED_CITY_SETTING}\n\nAuthority sits with the Tide Court, which meets at low water and adjourns when the stairs go under. Its writ runs exactly as far as the ward-work does, which is a matter of ongoing and occasionally violent dispute.`,
      }),
    ]),

    'wizard-lore': lane([
      canned('Five entries', {
        lore: [
          {
            title: 'The ward-work',
            body: 'The lattice of glyph-cut stone under Vessel that keeps the lower city dry enough to walk through at low water. Laid before the flood by engineers whose guild no longer exists. It is repaired, never extended: nobody living can cut a new line that holds.',
            category: 'cosmology',
          },
          {
            title: 'Tide Court',
            body: 'Vessel\u2019s governing body, so named because it sits only between the tides. A session that runs long is adjourned by the water itself, which is considered a feature — long deliberations are held to be a sign of a bad question.',
            category: 'history',
          },
          {
            title: 'Salvage right',
            body: 'The claim a diver holds over what they bring up from a drowned floor. It lapses at sunset, which is why the salvage quarter is loudest at dusk and empty by full dark.',
            category: 'law',
          },
          {
            title: 'Bell-speech',
            body: 'The rooftop bells carry a working vocabulary of about forty phrases — tide, fire, writ, sail, plague. Children learn it before they learn to read. Two bells answering each other means something is moving that should not be.',
            category: 'terminology',
          },
          {
            title: 'The Quiet Year',
            body: 'The twelve months after the flood when no bell was rung, by agreement, because there was nothing left to warn anyone about. Dating in Vessel still runs from its end rather than from the flood.',
            category: 'history',
          },
        ],
      }),
    ]),

    'wizard-cast': lane([
      canned('Five entries, mixed kinds', {
        entities: [
          {
            kind: 'character',
            name: 'Kael Ashwater',
            description:
              'A salvage diver working the guild floors below the old exchange. Careful, underpaid, and the only person still keeping a written record of which wards have failed.',
            status: 'active',
            speech: 'clipped, understated',
            traits: ['methodical', 'stubborn', 'good in cold water'],
            drives: ['finish the survey', 'avoid owing the Tide Court a favour'],
            faction_name: 'The Salvagers\u2019 Table',
          },
          {
            kind: 'character',
            name: 'Verity Sould',
            description:
              'A ward-keeper who inherited the maintenance ledgers and has read them all the way through, which is more than her predecessors managed.',
            status: 'staged',
            speech: 'formal, over-precise',
            traits: ['exacting', 'privately frightened'],
            drives: ['keep the lattice running', 'be believed'],
          },
          {
            kind: 'location',
            name: 'The Drowned Exchange',
            description:
              'Vessel\u2019s old trading hall, now three storeys under at high water. Its upper gallery is dry, rented out, and reachable only by rope bridge.',
            status: 'active',
            condition: 'flooded to the second gallery',
          },
          {
            kind: 'item',
            name: 'The survey ledger',
            description:
              'A wax-bound book of ward readings going back forty years, in four hands. Worth more than the building it is kept in.',
            status: 'active',
            condition: 'water-stained, legible',
          },
          {
            kind: 'faction',
            name: 'The Salvagers\u2019 Table',
            description:
              'The loose association of divers who work the drowned quarters. No charter, no dues, and an absolute rule about not diving another crew\u2019s floor.',
            status: 'active',
            agenda: ['keep salvage right lapsing at sunset', 'stay out of the Tide Court'],
            standing: 'tolerated, not represented',
          },
        ],
      }),
    ]),

    'wizard-opening': lane([canned('Short beat', opening(OPENING_PROSE))]),
    'wizard-opening-refine': lane([canned('Colder, slower', opening(OPENING_PROSE_REFINED))]),

    'wizard-title-chips': lane([
      canned('Five titles', {
        titles: [
          'The Quiet Year',
          'Bell-Speech',
          'What the Water Kept',
          'Salvage Right',
          'The Tide Court',
        ],
      }),
    ]),

    'wizard-description': lane([
      canned('Log line', {
        description:
          'A salvage diver in a half-drowned city finds the ward-work failing faster than anyone is willing to admit.',
      }),
    ]),
    'wizard-description-refine': lane([
      canned('Log line, sharper', {
        description:
          'A salvage diver discovers the wards holding her city above water are failing, and that the people who could fix them would rather not know.',
      }),
    ]),
  }
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
