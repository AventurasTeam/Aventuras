import { railDataFixture } from '@/components/reader/rail/rail-story-fixtures'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import type {
  CharacterState,
  Entity,
  Happening,
  HappeningAwareness,
  HappeningInvolvement,
  Lore,
  Thread,
} from '@/lib/db'
import type { RailCategory } from '@/lib/reader-rail'

import { peekModelOf, type PeekLeadControl, type PeekLinks, type PeekModel } from './peek-model'
import type { PeekEntityContext } from './use-peek-view'

const DAY = 86_400
const BASE = railDataFixture()
const BRANCH = BASE.branchId

const KAEL_STATE: CharacterState = {
  visual: {
    physique: 'lean, road-worn',
    face: 'a scar through the left brow',
    hair: 'black, cropped short',
  },
  traits: ['stubborn', 'quick with a blade', 'distrusts the Watch'],
  drives: ['learn what the amulet wants', 'keep Mira out of it'],
  current_location_id: 'loc_hollow',
  equipped_items: ['item_blade'],
  inventory: [],
  stackables: { coin: 12 },
  faction_id: 'fac_watch',
  lastSeenAt: { entryId: 'e_47', locationId: 'loc_hollow', worldTime: 1000 },
}

// Kael filled in, with a non-default injection mode, so every Overview region has content.
const ENTITIES = BASE.entities.map(
  (entity): Entity =>
    entity.id === 'char_kael'
      ? {
          ...entity,
          description: 'A courier who carries what the city would rather lose.',
          injectionMode: 'always',
          state: KAEL_STATE,
          tags: ['courier', 'chapter-1'],
        }
      : entity,
)

// Several lines at 440 px, for the thread and happening bodies that never clamp.
const LONG_DESCRIPTION =
  "The broker keeps two ledgers: one for the Watch's auditors, clean and dull, and one sewn " +
  'into the lining of his coat that names every captain who has taken Syndicate coin since the ' +
  'flood. Kael has seen a single page of it. Mira thinks the second ledger is a forgery planted ' +
  'to flush out exactly the kind of courier who would go looking for it, and she may be right.'

function lore(id: string, title: string, extra: Partial<Lore>): Lore {
  return {
    id,
    branchId: BRANCH,
    title,
    body: `${title}, as the Hollow tells it.`,
    category: null,
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const LORE: Lore[] = [
  ...BASE.lore,
  // Forty short lines, so the ~10-line clamp has thirty to hide.
  lore('lore_charter', 'The Veil charter', {
    body: Array.from({ length: 40 }, (_, i) => `Clause ${i + 1} of the Veil charter.`).join('\n'),
    category: 'history',
    tags: ['founding', 'veil'],
    injectionMode: 'always',
    priority: 73,
  }),
  // A non-default injection mode alone still earns the chip row.
  lore('lore_seal', 'The harbour seal', { injectionMode: 'disabled' }),
  // `auto` and no category: nothing for a chip row to say.
  lore('lore_tides', 'The tide tables', {}),
]

function thread(id: string, title: string, extra: Partial<Thread>): Thread {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const THREADS: Thread[] = [
  ...BASE.threads,
  thread('t_oath', 'Keep the oath to the Watch', {
    description: 'Kael swore to carry the Watch seal to the harbour before the tide turns.',
    category: 'vow',
    icon: 'shield',
    injectionMode: 'always',
  }),
  thread('t_ledger', "The broker's second ledger", { description: LONG_DESCRIPTION }),
]

function happening(id: string, title: string, extra: Partial<Happening>): Happening {
  return {
    id,
    branchId: BRANCH,
    title,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const HAPPENINGS: Happening[] = [
  ...BASE.happenings.map(
    (row): Happening =>
      row.id === 'h_ambush'
        ? { ...row, description: 'Three Syndicate knives in the rain behind the tannery.' }
        : row,
  ),
  happening('h_eclipse', 'The red eclipse', {
    description: 'The sky over the Hollow burned red for an hour; every street saw it.',
    category: 'omen',
    icon: 'eye',
    occurredAtEntryId: 'e_52',
    commonKnowledge: 1,
  }),
  happening('h_founding', 'The founding of the Watch', {
    description: 'The Watch took its oath on the seawall.',
    category: 'history',
    temporal: 'three winters before the story',
  }),
  // Common knowledge with no when-marker and no category: the ⊙ alone fills the chip row.
  happening('h_rumour', 'The drowned bell', { commonKnowledge: 1 }),
  happening('h_ledger', 'The ledger page', { description: LONG_DESCRIPTION }),
]

const PEEK_DATA = railDataFixture({
  entities: ENTITIES,
  lore: LORE,
  threads: THREADS,
  happenings: HAPPENINGS,
})

function involvement(id: string, happeningId: string, entityId: string): HappeningInvolvement {
  return { id, branchId: BRANCH, happeningId, entityId, role: null }
}

function awareness(id: string, happeningId: string, characterId: string): HappeningAwareness {
  return {
    id,
    branchId: BRANCH,
    happeningId,
    characterId,
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

function byId<Row extends { id: string }>(rows: readonly Row[]): ReadonlyMap<string, Row> {
  return new Map(rows.map((row) => [row.id, row]))
}

// The ambush: two involved, one aware. The eclipse is common knowledge, so it has no awareness.
const PEEK_LINKS: PeekLinks = {
  involvements: byId([
    involvement('hi_kael', 'h_ambush', 'char_kael'),
    involvement('hi_mira', 'h_ambush', 'char_mira'),
    involvement('hi_vorne', 'h_eclipse', 'char_vorne'),
    involvement('hi_watch', 'h_founding', 'fac_watch'),
  ]),
  awareness: byId([
    awareness('ha_mira', 'h_ambush', 'char_mira'),
    awareness('ha_kael', 'h_founding', 'char_kael'),
  ]),
}

export const PEEK_ENTITY_CONTEXT: PeekEntityContext = {
  entities: PEEK_DATA.entities,
  worldTime: 1000 + 2 * DAY,
  calendar: EARTH_GREGORIAN,
}

export const PEEK_LEAD_CONTROL: PeekLeadControl = {
  leadId: 'char_kael',
  blocked: false,
  blockedReason: undefined,
  pending: false,
  onSetLead: () => {},
}

/** The peek model for a fixture row, resolved as the hosts resolve it; throws on a miss. */
export function peekModelFixture(category: RailCategory, id: string): PeekModel {
  const model = peekModelOf({ category, id }, PEEK_DATA, PEEK_LINKS)
  if (model == null) throw new Error(`No peek fixture row for ${category} ${id}`)
  return model
}
