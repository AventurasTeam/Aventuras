import { awarenessOfListedOnly, createdCharacters, newCharacterNamed } from '../checks'
import { action, character, entries, narration, place, reply, type EvalWindow } from '../fixture'

export const namedrops: EvalWindow = {
  name: 'namedrops',
  about:
    'names dropped in an oath, a saying and a song, beside a named man the story sets out after',
  entities: [
    character('char_wren', 'Wren Talbot', { description: 'A courier who carries sealed letters.' }),
    character('char_odo', 'Odo', { description: 'The innkeeper of the Lantern.' }),
    place('loc_lantern', 'The Lantern', { description: 'A coaching inn on the coast road.' }),
  ],
  happenings: [],
  relationships: [],
  threads: [],
  entries: entries('namedrops', { scene: ['char_wren', 'char_odo'], location: 'loc_lantern' }, [
    action('Wren asks Odo whether anyone has come asking for her.'),
    narration(
      `Odo wiped the same tankard for the third time. "By Saint Aldric's bones, I'd never seen him before," he said. "Tall, grey coat, asked twice whether you'd come through. As old King Harrow used to say, a man who asks twice already knows the answer."

He set the tankard down. "He gave his name as Jorun Vask. Said you'd find him at the Copper Bell by the north gate, when you were ready to talk."`,
    ),
    action('Wren decides to go to the Copper Bell tonight and find Jorun Vask.'),
    narration(
      `Wren finished her cider while the fiddler in the corner worked through Merrit's ballad of the drowned bells, the one every inn on the coast knew by heart. She left a coin on the bar, and her room key beside it.`,
    ),
  ]),
  checks: [
    {
      name: 'Jorun Vask, whom Wren sets out to find, is a new character',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => newCharacterNamed(r, /^jorun( vask)?$/i) != null,
    },
    {
      name: 'no new character for a name only invoked: a saint in an oath, a king in a saying, a song’s maker',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) => !createdCharacters(r).some((c) => /aldric|harrow|merrit/i.test(c.name)),
    },
    {
      name: 'the fiddler, a passing figure, is not a new character',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) => newCharacterNamed(r, /fiddler/i) == null,
    },
    {
      name: 'the Copper Bell, a named place, is no character',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => newCharacterNamed(r, /copper|bell/i) == null,
    },
    awarenessOfListedOnly([]),
  ],
  ideal: reply({
    happenings: [
      {
        title: 'A stranger asks after Wren',
        description:
          'Jorun Vask asks Odo twice whether Wren has come through, and leaves word for her.',
        category: 'an inquiry',
        involvements: [
          { ref: 'new:jorun', role: 'actor' },
          { ref: 'char_wren', role: 'target' },
          { ref: 'loc_lantern', role: 'site' },
        ],
        awareness: [
          { ref: 'char_odo', source: 'witnessed firsthand', severity: 0.3 },
          { ref: 'char_wren', source: 'told by Odo', severity: 0.6, learnedAtTurn: 't2' },
        ],
        temporal: 'before the story',
        sourceTurn: 't2',
      },
    ],
    newCharacters: [
      {
        handle: 'new:jorun',
        name: 'Jorun Vask',
        description: 'A tall man in a grey coat who asked after Wren at the Lantern.',
        keywords: ['the man in the grey coat'],
        sourceTurn: 't2',
      },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_wren',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
    ],
    newCharacters: [
      {
        handle: 'new:aldric',
        name: 'Saint Aldric',
        description: 'x',
        keywords: [],
        sourceTurn: 't2',
      },
      {
        handle: 'new:fiddler',
        name: 'The fiddler',
        description: 'x',
        keywords: [],
        sourceTurn: 't4',
      },
      {
        handle: 'new:bell',
        name: 'The Copper Bell',
        description: 'x',
        keywords: [],
        sourceTurn: 't2',
      },
    ],
  }),
}
