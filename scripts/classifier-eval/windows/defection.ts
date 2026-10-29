import {
  awarenessOfListedOnly,
  createdCharacters,
  factionAfter,
  involves,
  isRecounted,
} from '../checks'
import {
  action,
  character,
  entries,
  faction,
  narration,
  place,
  reply,
  type EvalWindow,
} from '../fixture'

export const defection: EvalWindow = {
  name: 'defection',
  about: 'a sergeant swears to another faction; an agent wears his old one’s coat as a disguise',
  entities: [
    faction('fact_wardens', 'Salt Wardens', {
      description: 'The river toll-keepers of the Greywater.',
      standing: 'Hold the river tolls under the Count’s charter',
    }),
    faction('fact_varro', 'House Varro', {
      description: 'A merchant house buying up the river trade.',
      standing: 'Rich, and courting the Count',
    }),
    character('char_brann', 'Brann Holt', {
      description: 'A sergeant of the Salt Wardens, twelve years on the Saltgate.',
      faction: 'fact_wardens',
    }),
    character('char_maela', 'Maela', {
      description: 'An agent of House Varro.',
      faction: 'fact_varro',
    }),
    place('loc_tollhouse', 'Saltgate toll-house', {
      description: 'The Wardens’ toll-house over the Greywater lock.',
    }),
  ],
  happenings: [],
  relationships: [],
  threads: [],
  entries: entries('defection', { scene: ['char_brann', 'char_maela'] }, [
    action(
      'Maela offers Brann a sergeant’s place in House Varro’s guard if he brings her the toll ledgers.',
    ),
    narration(
      `Brann turned the cup in his big hands for a long time. Twelve years he'd worn the Warden badge, he said. Twelve years of other men's tolls, and the year his brother came up a crown short at the Saltgate count, the Wardens had hanged him from the toll-house crane and left him for the gulls.

"I'll want it in writing," he said at last. "And I'll want the man who signed that warrant."

Maela slid the paper across the table. He read it twice, then unpinned the tarnished badge from his coat, dropped it in the dregs of his ale, and knelt on the alehouse's sawdust to put his lips to the Varro signet on her hand. "Tell your lord he's bought himself a sergeant."`,
    ),
    action(
      'Maela borrows a Warden’s coat so the two of them can walk into the Saltgate toll-house unchallenged.',
      { location: 'loc_tollhouse' },
    ),
    narration(
      `The coat was too broad in the shoulders, but in the fog nobody looked twice at a Warden walking beside a Warden sergeant. The gate-boy saluted Brann out of habit. Inside, the ledger room smelled of tallow and wet paper; Brann knew which shelf, and which book on it held the second set of figures. Maela had the ledgers in her satchel before the bell rang the watch, and they were back out in the fog before anyone thought to ask why Sergeant Holt had come in on his rest day.`,
      { location: 'loc_tollhouse' },
    ),
  ]),
  checks: [
    {
      name: 'Brann ends the window in House Varro',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => factionAfter(r, 'char_brann', 'fact_wardens') === 'fact_varro',
    },
    {
      name: 'his membership sits at t2, where he swears',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.memberships.some(
          (m) =>
            m.character === 'char_brann' && m.faction === 'fact_varro' && m.sourceTurn === 't2',
        ),
    },
    {
      name: 'Maela’s borrowed coat changes no membership of hers',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.memberships.some((m) => m.character === 'char_maela'),
    },
    // The warrant's signer is left unscored: Brann demands him, so the story may be heading for him.
    {
      name: 'no new character but the warrant’s signer: the gate-boy and the hanged brother go unnamed',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) => createdCharacters(r).every((c) => /warrant|sign/i.test(c.name)),
    },
    {
      name: 'no new faction for a listed one',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.newFactions.some((f) => /warden|varro/i.test(f.name)),
    },
    {
      name: 'the ledger theft is a happening involving Brann and Maela',
      kind: 'expect',
      basis: 'judgment',
      holds: (r) =>
        r.happenings.some((h) => involves(h, 'char_brann') && involves(h, 'char_maela')),
    },
    {
      name: 'a happening involves the toll-house, where the theft happened',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some((h) => involves(h, 'loc_tollhouse')),
    },
    // The brother's hanging is told as past and is its own happening, whether or not it is dated.
    {
      name: 'the alehouse bargain is one happening, not an offer and an acceptance',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) =>
        r.happenings.filter(
          (h) =>
            !isRecounted(h) &&
            (h.sourceTurn === 't1' || h.sourceTurn === 't2') &&
            !/hang|brother|execut|crane|death|kill/i.test(h.title),
        ).length <= 1,
    },
    awarenessOfListedOnly([]),
  ],
  ideal: reply({
    memberships: [{ character: 'char_brann', faction: 'fact_varro', sourceTurn: 't2' }],
    happenings: [
      {
        title: 'The Saltgate ledgers stolen',
        description:
          'Brann leads a disguised Maela into the toll-house and they take the Wardens’ second set of ledgers.',
        category: 'a theft',
        icon: 'scroll',
        involvements: [
          { ref: 'char_brann', role: 'actor' },
          { ref: 'char_maela', role: 'actor' },
          { ref: 'fact_wardens', role: 'target' },
          { ref: 'loc_tollhouse', role: 'site' },
        ],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_brann',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
    ],
    happenings: [
      { title: 'Maela’s offer', involvements: [], awareness: [], sourceTurn: 't1' },
      { title: 'Brann accepts', involvements: [], awareness: [], sourceTurn: 't2' },
    ],
    memberships: [{ character: 'char_maela', faction: 'fact_wardens', sourceTurn: 't4' }],
    newCharacters: [
      { handle: 'new:boy', name: 'Gate-boy', description: 'x', keywords: [], sourceTurn: 't4' },
    ],
    newFactions: [
      {
        handle: 'new:wardens',
        name: 'Salt Wardens',
        description: 'x',
        keywords: [],
        sourceTurn: 't2',
      },
    ],
  }),
}
