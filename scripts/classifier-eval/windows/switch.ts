import type { ClassifierExtraction } from '@/lib/classifier'

import { awarenessOfListedOnly, involves } from '../checks'
import { action, character, entries, narration, place, reply, type EvalWindow } from '../fixture'

const WENNA = 'char_wenna'
const DACE = 'char_dace'
// Wenna's turns: written at the archive, alone, before the user set Dace as the lead.
const AT_THE_ARCHIVE = { scene: [WENNA], location: 'loc_archive', lead: WENNA }

type ReplyHappening = ClassifierExtraction['happenings'][number]

// What each lead's turns established, as a happening's title or description tells it.
const BREAK_IN = /\b(chart|archive|lock\w*|palm|customs)\b/i
const PASSAGE = /\b(ring|ferry\w*|passage|skell)\b/i

const tells = (h: ReplyHappening, fact: RegExp): boolean =>
  fact.test(`${h.title} ${h.description ?? ''}`)

const credits = (h: ReplyHappening, ref: string): boolean =>
  involves(h, ref) || h.awareness.some((a) => a.ref === ref)

// Adventure, first person, "I" never named: the user played Wenna through the break-in, then set
// Dace as lead. Unmarked, only the scene (Wenna alone at the archive) contradicts the lead line.
export const switchWindow: EvalWindow = {
  name: 'switch',
  about: 'a lead switch partway: two turns written under Wenna, then two under Dace, the lead now',
  lead: DACE,
  entities: [
    character(WENNA, 'Wenna Sorrel', {
      description: 'A chandler’s widow who rents the room above her shop.',
    }),
    character(DACE, 'Dace Hollin', {
      description: 'A deserter from the harbour watch.',
      isLead: 1,
    }),
    character('char_lunt', 'Ebbe Lunt', {
      description: 'A ferryman who works the night crossing to Skell.',
    }),
    place('loc_archive', 'Customs House archive', {
      description: 'The harbour’s chart room, behind the Customs House counting floor.',
    }),
    place('loc_quay', 'North quay', { description: 'The ferry stair below the harbour wall.' }),
  ],
  happenings: [],
  relationships: [],
  threads: [],
  entries: entries(
    'switch',
    { scene: [DACE, 'char_lunt'], location: 'loc_quay' },
    [
      action(
        'I kneel at the archive door and work the old lock with my picks while the night clerk snores at his desk.',
        AT_THE_ARCHIVE,
      ),
      narration(
        `The lock is older than the Customs House and twice as stubborn. It takes me the better part of an hour, and when the last ward finally turns, my tension pick snaps and the broken end opens my palm from thumb to wrist. I bite down on my sleeve until the worst of it passes, bind the hand in my scarf and slip inside.

The harbour charts hang in oilcloth tubes along the back wall, each labelled in the same cramped hand. The Calder Shoals chart is the third from the end. I roll it tight, push it down inside my coat and lock the door behind me with my good hand. The clerk never stirs.`,
        AT_THE_ARCHIVE,
      ),
      action(
        'I wait under the quay lamp for Ebbe Lunt and ask whether the night ferry still crosses to Skell.',
      ),
      narration(
        `Ebbe Lunt takes his time answering, the way he takes his time over everything. "She crosses," he says at last, "for them as can pay." When I tell him I can't, his eyes go to the silver ring on my hand, my father's, the only thing of his I kept. I hold it out before I can think better of it. He bites it, pockets it and jerks his head at the boat.

We push off into the fog with the tide under us. Halfway across, the lamp on the Skell landing shows through the murk, and Lunt tells me to keep my head down when we come in.`,
      ),
    ],
    DACE,
  ),
  checks: [
    {
      name: 'the archive break-in is Wenna’s: a happening telling it involves her or gives her awareness',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some((h) => tells(h, BREAK_IN) && credits(h, WENNA)),
    },
    {
      name: 'the archive break-in is not credited to Dace, the lead after it',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.happenings.some((h) => tells(h, BREAK_IN) && credits(h, DACE)),
    },
    {
      name: 'the ring paid for passage is Dace’s: a happening telling it involves him or gives him awareness',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some((h) => tells(h, PASSAGE) && credits(h, DACE)),
    },
    {
      name: 'the ring paid for passage is not credited to Wenna',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.happenings.some((h) => tells(h, PASSAGE) && credits(h, WENNA)),
    },
    awarenessOfListedOnly([]),
  ],
  ideal: reply({
    happenings: [
      {
        title: 'Wenna steals the Calder Shoals chart',
        description:
          'Wenna picks the Customs House archive lock while the night clerk sleeps, cuts her palm open on a snapped pick, and takes the Calder Shoals chart.',
        category: 'a theft',
        involvements: [
          { ref: WENNA, role: 'actor' },
          { ref: 'loc_archive', role: 'site' },
        ],
        awareness: [{ ref: WENNA, source: 'did it', severity: 0.8 }],
        sourceTurn: 't2',
      },
      {
        title: 'Dace pays his passage to Skell',
        description:
          'With no money for the crossing, Dace gives Ebbe Lunt his late father’s silver ring, and Lunt takes him over to Skell in the fog.',
        category: 'a bargain',
        involvements: [
          { ref: DACE, role: 'actor' },
          { ref: 'char_lunt', role: 'actor' },
          { ref: 'loc_quay', role: 'site' },
        ],
        awareness: [
          { ref: DACE, source: 'took part', severity: 0.6 },
          { ref: 'char_lunt', source: 'took part', severity: 0.3 },
        ],
        sourceTurn: 't4',
      },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    knownAwareness: [
      { happening: 'hap_unlisted', ref: DACE, source: 'x', severity: 0.5, learnedAtTurn: 't2' },
    ],
    happenings: [
      {
        title: 'Dace steals the Calder Shoals chart',
        description: 'I pick the archive lock, cut my palm and take the chart.',
        involvements: [{ ref: DACE, role: 'actor' }],
        awareness: [],
        sourceTurn: 't2',
      },
      {
        title: 'Wenna pays her passage with a ring',
        description: 'Wenna gives Ebbe Lunt a silver ring for the ferry.',
        involvements: [{ ref: WENNA, role: 'actor' }],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
  }),
}
