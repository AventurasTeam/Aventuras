import { awarenessOfListedOnly, newCharacterNamed } from '../checks'
import {
  action,
  character,
  entries,
  happening,
  narration,
  place,
  relationship,
  reply,
  type EvalWindow,
} from '../fixture'

export const learning: EvalWindow = {
  name: 'learning',
  about: 'a character learns of a listed happening from someone who calls him master, as listed',
  entities: [
    character('char_idris', 'Idris Vell', {
      description: 'A guild alchemist, back from the coast.',
    }),
    character('char_oriel', 'Oriel', { description: 'Idris’s apprentice, near a journeyman now.' }),
    character('char_senna', 'Lady Senna', {
      description: 'A noblewoman of Ostmark.',
      status: 'retired',
    }),
    place('loc_workshop', 'Vell’s workshop', { description: 'An alchemist’s shop off the quay.' }),
  ],
  happenings: [
    happening('hap_poisoning', 'The poisoning of Lady Senna at the harvest feast'),
    happening('hap_belltower', 'The bell tower fire in Ostmark'),
  ],
  relationships: [
    relationship('rel_idris_oriel', 'char_idris', 'char_oriel', 'apprentice', 'master'),
  ],
  threads: [],
  entries: entries('learning', { scene: ['char_idris', 'char_oriel'], location: 'loc_workshop' }, [
    action('Idris comes home from the coast and asks Oriel what he missed.'),
    narration(
      `Oriel didn't look up from the alembic at first, which was how Idris knew it was bad.

"Lady Senna's dead, master. At the harvest feast, three nights after you left. They say it was the wine." He wiped his hands on his apron, slowly. "Her cupbearer ran the same night. A boy called Tam Rook. And the steward's been round twice asking which alchemists sold nightshade tincture this season. Our name's on his list."

Idris set his bag down very carefully on the bench. Senna had bought her sleeping draughts from this workshop for eleven years.`,
    ),
    action('Idris tells Oriel to find Tam Rook before the steward does.'),
    narration(
      `"Before the steward does," Oriel repeated, and for a moment he looked like the boy Idris had taken in off the quay rather than the near-journeyman he'd become. Then he nodded. "Tam's got an aunt in the net-sheds. I'll start there."

"Take the back stair," Idris said. "And Oriel." The apprentice paused in the doorway. "Thank you. You've kept this shop standing while I was gone."

Oriel ducked his head, pleased and embarrassed at once, and was gone.`,
    ),
  ]),
  checks: [
    {
      name: 'Idris learns of the listed poisoning',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.knownAwareness.some((k) => k.happening === 'hap_poisoning' && k.ref === 'char_idris'),
    },
    {
      name: 'his learning sits at t2',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.knownAwareness.some(
          (k) =>
            k.happening === 'hap_poisoning' && k.ref === 'char_idris' && k.learnedAtTurn === 't2',
        ),
    },
    {
      name: 'the poisoning is not added again',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.happenings.some((h) => /poison|senna/i.test(h.title)),
    },
    {
      name: 'the listed master and apprentice views are not restated',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) =>
        !r.relationships.some(
          (x) =>
            (x.subject === 'char_idris' && x.object === 'char_oriel') ||
            (x.subject === 'char_oriel' && x.object === 'char_idris'),
        ),
    },
    {
      name: 'Tam Rook is a new character',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => newCharacterNamed(r, /^tam( rook)?$/i) != null,
    },
    {
      name: 'Tam Rook, who fled, is not made dead',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) =>
        !r.happenings.some((h) =>
          /\b(death|murder|killing) of tam\b|\btam\b.*\b(death|dies|died|dead|killed)\b/i.test(
            h.title,
          ),
        ),
    },
    // Adding the steward is left unscored; one added as no more than "the steward" is lost a few
    // turns on, since nothing in the reply says what he is doing.
    {
      name: 'a steward, if added, is described by what he is doing',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) => {
        const steward = newCharacterNamed(r, /steward/i)
        return (
          steward == null || /nightshade|alchemist|poison|senna|list/i.test(steward.description)
        )
      },
    },
    {
      name: 'finding Tam is a new thread',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.newThreads.some((t) => /tam|rook|cupbearer/i.test(`${t.title} ${t.description}`)),
    },
    {
      name: 'the unrelated listed fire gets no awareness',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.knownAwareness.some((k) => k.happening === 'hap_belltower'),
    },
    awarenessOfListedOnly(['hap_poisoning', 'hap_belltower']),
  ],
  ideal: reply({
    knownAwareness: [
      {
        happening: 'hap_poisoning',
        ref: 'char_idris',
        source: 'told by Oriel',
        severity: 0.9,
        learnedAtTurn: 't2',
      },
    ],
    newCharacters: [
      {
        handle: 'new:tam',
        name: 'Tam Rook',
        description: 'Lady Senna’s cupbearer, who fled the night she died.',
        keywords: ['the cupbearer'],
        sourceTurn: 't2',
      },
    ],
    newThreads: [
      {
        title: 'Find Tam Rook before the steward does',
        description:
          'Oriel goes looking for the fled cupbearer, starting with his aunt in the net-sheds.',
        status: 'active',
        sourceTurn: 't4',
      },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    happenings: [
      {
        title: 'Lady Senna’s death',
        involvements: [{ ref: 'char_senna', role: 'target' }],
        awareness: [],
        sourceTurn: 't2',
      },
      { title: 'Tam Rook’s death', involvements: [], awareness: [], sourceTurn: 't2' },
    ],
    newCharacters: [
      {
        handle: 'new:steward',
        name: 'the steward',
        description: 'The steward.',
        keywords: [],
        sourceTurn: 't2',
      },
    ],
    relationships: [
      { subject: 'char_oriel', object: 'char_idris', kind: 'master', sourceTurn: 't2' },
    ],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_idris',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
      {
        happening: 'hap_belltower',
        ref: 'char_idris',
        source: 'x',
        severity: 0.1,
        learnedAtTurn: 't2',
      },
    ],
  }),
}
