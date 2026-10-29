import { awarenessOfListedOnly, isRecounted, newCharacterNamed } from '../checks'
import { action, character, entries, narration, place, reply, type EvalWindow } from '../fixture'

export const reveal: EvalWindow = {
  name: 'reveal',
  about: 'a listed stranger gives her name, an epithet and then a cover name',
  entities: [
    character('char_grey', 'Woman in grey', {
      description: 'A woman in a grey travelling cloak who has followed Corwin since Ostmark.',
    }),
    character('char_corwin', 'Corwin Hale', {
      description: 'A chandler’s son wearing his late mother’s ring.',
    }),
    place('loc_market', 'Tallow Market', { description: 'A covered market of candle-makers.' }),
  ],
  happenings: [],
  relationships: [],
  threads: [],
  entries: entries('reveal', { scene: ['char_corwin', 'char_grey'], location: 'loc_market' }, [
    action(
      'Corwin doubles back through the stalls and corners the woman in grey behind the candle-maker’s awning.',
    ),
    narration(
      `She didn't run, which annoyed him more than if she had. She let him back her against the awning post, glanced at the knife in his hand as if it were a poor attempt at conversation, and pushed back her hood.

She was younger than he'd guessed, with ink-stained fingers and a nose that had been broken at least once. "You can stop thinking of me as the woman in grey," she said. "My name is Ilse Marrow. Down on the wharves they call me the Heron, but only people who owe me money, so I'd rather you didn't."

"Why are you following me?"

"Because you're wearing something I've been paid to find." Her eyes went to his hand, to the ring with its chip of green stone.`,
    ),
    action('Corwin hides his hand and asks who paid her.'),
    narration(
      `Ilse didn't answer. A fishmonger was pushing his barrow down the row toward them, and she stepped out to meet him with a sudden widow's stoop and a quaver in her voice. "Mistress Penn, sir, from Tanner's Row. Have you any eel left?" While the man fussed over his ice she palmed a folded note into Corwin's pocket.

By the time the barrow had passed she was straight-backed again and twenty paces off. The note said only: The ring was never your mother's. Ask your father whose it was.`,
    ),
  ]),
  checks: [
    {
      name: 'the woman in grey is renamed Ilse Marrow',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.renames.some((n) => n.ref === 'char_grey' && /ilse/i.test(n.name)),
    },
    {
      name: 'the Heron is an alias of hers',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.aliases.some((a) => a.ref === 'char_grey' && a.terms.some((t) => /heron/i.test(t))),
    },
    {
      name: 'her cover name, Mistress Penn, is an alias of hers',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.aliases.some((a) => a.ref === 'char_grey' && a.terms.some((t) => /penn/i.test(t))),
    },
    {
      name: 'no new character for her, under any of her names',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => newCharacterNamed(r, /ilse|marrow|heron|penn/i) == null,
    },
    {
      name: 'the cover name renames no one',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.renames.some((n) => /penn/i.test(n.name)),
    },
    {
      name: 'the passing fishmonger is not a new character',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) => newCharacterNamed(r, /fish/i) == null,
    },
    {
      name: 'the meeting in the market is one happening, not one a beat',
      kind: 'expect',
      basis: 'judgment',
      holds: (r) => r.happenings.filter((h) => !isRecounted(h)).length === 1,
    },
    {
      name: 'a happening tells the meeting’s moments: the cornering, her name, the note',
      kind: 'expect',
      basis: 'judgment',
      holds: (r) =>
        r.happenings.some((h) =>
          [/corner|knife|confront|awning/i, /ilse|marrow|heron/i, /note/i].every((moment) =>
            moment.test(h.description ?? ''),
          ),
        ),
    },
    awarenessOfListedOnly([]),
  ],
  ideal: reply({
    happenings: [
      {
        title: 'Corwin corners Ilse in Tallow Market',
        description:
          'Corwin corners the woman in grey, who gives her name as Ilse Marrow and says she was paid to find his ring; posing as Mistress Penn, she slips him a note saying the ring was never his mother’s.',
        category: 'an encounter',
        involvements: [
          { ref: 'char_corwin', role: 'actor' },
          { ref: 'char_grey', role: 'actor' },
          { ref: 'loc_market', role: 'site' },
        ],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
    renames: [{ ref: 'char_grey', name: 'Ilse Marrow', sourceTurn: 't2' }],
    aliases: [
      { ref: 'char_grey', terms: ['the Heron'], sourceTurn: 't2' },
      { ref: 'char_grey', terms: ['Mistress Penn'], sourceTurn: 't4' },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_corwin',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
    ],
    newCharacters: [
      { handle: 'new:ilse', name: 'Ilse Marrow', description: 'x', keywords: [], sourceTurn: 't2' },
      { handle: 'new:fish', name: 'Fishmonger', description: 'x', keywords: [], sourceTurn: 't4' },
    ],
    renames: [{ ref: 'char_grey', name: 'Mistress Penn', sourceTurn: 't4' }],
  }),
}
