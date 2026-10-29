import { awarenessOfListedOnly, createdCharacters, involves, newCharacterNamed } from '../checks'
import {
  action,
  character,
  entries,
  narration,
  place,
  reply,
  thread,
  type EvalWindow,
} from '../fixture'

// Adventure mode: second-person narration of the lead, Tobin, and first-person actions. The prompt
// names no lead, and Pell shares the scene without a word in the prose, so nothing but knowing the
// lead tells "you" from Pell.
export const ambush: EvalWindow = {
  name: 'ambush',
  about: 'a fight across two turns, narrated in the second person',
  entities: [
    character('char_pell', 'Pell', { description: 'A drover hired for the salt road.' }),
    character('char_tobin', 'Tobin Ash', { description: 'A salt carter out of Ostmark.' }),
    character('char_sefa', 'Sefa', {
      description: 'The salt cart’s guard, a crossbow across her knees.',
    }),
    place('loc_crossing', 'Greywater crossing', {
      description: 'A rope ferry over the Greywater, a day north of Ostmark.',
    }),
  ],
  happenings: [],
  relationships: [],
  threads: [thread('thr_delivery', 'Deliver the salt cart to Ostmark', 'active')],
  entries: entries(
    'ambush',
    { scene: ['char_pell', 'char_tobin', 'char_sefa'], location: 'loc_crossing' },
    [
      action('I tell Sefa to hold the cart back and ride ahead to check the crossing.'),
      narration(
        `You leave Sefa with the cart and walk your horse down to Greywater crossing. The river runs high and brown with snowmelt, loud enough to cover a careless step. Halfway down the bank you see why the ferry rope hangs slack: someone has cut it.

Three riders come out of the willows on the far side and splash into the shallows. The one in front is a broad man with a burn scar from jaw to ear and a boar spear across his saddle. "Toll's gone up," he calls. "Cart, horse, and whatever's in the cart." Behind him a younger rider nocks an arrow and doesn't bother aiming it anywhere in particular.

Up the bank, Sefa has seen them too. You hear the cart brake bite.`,
      ),
      action('I draw my sword and charge the scarred man before the archer can settle.'),
      narration(
        `You put your heels in and your horse takes the shallows in three long, spraying strides. The scarred man is quick for his size; the spear comes up and you knock it wide with the flat of your blade, and your shoulder takes him out of the saddle. He goes under and comes up choking.

The archer's first arrow goes past your ear. His second never leaves the string: a crossbow bolt from the bank takes him through the forearm and he drops the bow, screaming. Sefa is already winding the crossbow again, but the third rider has seen enough and is gone into the willows at a gallop.

The scarred man drags himself onto the gravel, one hand pressed to his ribs. "Hask," he spits when you ask his name, as if it costs him. "Dov Hask. You'll want to remember it."

When Sefa comes down the bank leading the cart horse, there's an arrow standing in her thigh that you never saw land. She snaps the shaft off short, swears at it, and sits down hard on the cart step, grey to the lips.`,
      ),
    ],
  ),
  checks: [
    {
      name: 'Dov Hask is a new character',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => newCharacterNamed(r, /hask/i) != null,
    },
    {
      name: 'the fight is one happening, not one a beat',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.length === 1,
    },
    {
      name: 'a happening tells the fight’s moments: the cut rope, Hask, Sefa’s wound',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.happenings.some((h) =>
          [/rope/i, /hask|scar/i, /thigh|wound|injur|hurt|\bhit\b|struck/i].every((moment) =>
            moment.test(h.description ?? ''),
          ),
        ),
    },
    {
      name: 'a happening sits at t4, the fight’s last turn',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some((h) => h.sourceTurn === 't4'),
    },
    {
      name: 'a happening involves Tobin, the prose’s "you"',
      kind: 'expect',
      basis: 'judgment',
      holds: (r) => r.happenings.some((h) => involves(h, 'char_tobin')),
    },
    {
      name: 'Pell, never in the prose, is involved in no happening',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) => !r.happenings.some((h) => involves(h, 'char_pell')),
    },
    {
      name: 'a happening involves Sefa',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some((h) => involves(h, 'char_sefa')),
    },
    {
      name: 'a happening involves the crossing, where it happened',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some((h) => involves(h, 'loc_crossing')),
    },
    {
      name: 'Sefa, wounded, is not retired',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.statusFlips.some((f) => f.ref === 'char_sefa' && f.to === 'retired'),
    },
    {
      name: 'no new character stands for "you"',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) =>
        !r.newCharacters.some((c) =>
          /\b(you|tobin|traveller|traveler|player|protagonist)\b/i.test(c.name),
        ),
    },
    {
      name: 'the archer and the third rider, never named, are not new characters',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) =>
        createdCharacters(r).every((c) => /hask/i.test(c.name) && !/archer|rider/i.test(c.name)),
    },
    awarenessOfListedOnly([]),
  ],
  ideal: reply({
    happenings: [
      {
        title: 'Ambush at Greywater crossing',
        description:
          'Dov Hask’s riders cut the ferry rope and demand the cart; Tobin unhorses Hask, Sefa shoots the archer, and an arrow wounds Sefa in the thigh.',
        category: 'battle',
        icon: 'swords',
        involvements: [
          { ref: 'char_tobin', role: 'actor' },
          { ref: 'char_sefa', role: 'actor' },
          { ref: 'new:hask', role: 'actor' },
          { ref: 'loc_crossing', role: 'site' },
        ],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
    newCharacters: [
      {
        handle: 'new:hask',
        name: 'Dov Hask',
        description: 'A burn-scarred bandit who held Greywater crossing for toll.',
        keywords: ['the scarred man'],
        sourceTurn: 't4',
      },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    happenings: [
      {
        title: 'Pell charges the scarred man',
        involvements: [{ ref: 'char_pell', role: 'actor' }],
        awareness: [],
        sourceTurn: 't4',
      },
    ],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_tobin',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
    ],
    statusFlips: [
      { ref: 'char_sefa', to: 'retired', reason: 'shot in the thigh', sourceTurn: 't4' },
    ],
    newCharacters: [
      { handle: 'new:you', name: 'You', description: 'The rider.', keywords: [], sourceTurn: 't2' },
      {
        handle: 'new:archer',
        name: 'Younger rider',
        description: 'x',
        keywords: ['the archer'],
        sourceTurn: 't2',
      },
    ],
  }),
}
