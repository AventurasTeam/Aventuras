import { awarenessOfListedOnly, involves, isRecounted, newCharacterNamed } from '../checks'
import {
  action,
  character,
  entries,
  happening,
  narration,
  place,
  reply,
  type EvalWindow,
} from '../fixture'

export const recounted: EvalWindow = {
  name: 'recounted',
  about: 'an event from thirty years before the story, told by a witness',
  entities: [
    character('char_nessa', 'Nessa Quill', {
      description: 'A harbour clerk from Ostmark asking questions about old wrecks.',
    }),
    character('char_brannoc', 'Brannoc', {
      description: 'The old keeper of the Calder Point lighthouse.',
    }),
    place('loc_ostmark', 'Ostmark', { description: 'A salt port at the mouth of the Greywater.' }),
    place('loc_lighthouse', 'Calder Point lighthouse', {
      description:
        'A stone tower on the headland north of Ostmark, above the reef called the Teeth.',
      parent: 'loc_ostmark',
    }),
  ],
  happenings: [happening('hap_belltower', 'The bell tower fire in Ostmark')],
  relationships: [],
  threads: [],
  entries: entries(
    'recounted',
    { scene: ['char_nessa', 'char_brannoc'], location: 'loc_lighthouse' },
    [
      action(
        'Nessa asks Brannoc why the Calder Point lamp stays dark on storm nights, when ships need it most.',
      ),
      narration(
        `Brannoc didn't answer at once. He fed another wedge of driftwood to the stove and watched it catch, and when he spoke it was to the fire rather than to her.

"Thirty winters back, I kept that lamp burning every night there was. Then a night came when the Count's men climbed the stair and told me to put it out." He rubbed his thumb along a burn scar on his wrist. "The Marigold was running for Ostmark ahead of a gale. Without the light she took the Teeth broadside. I watched from the gallery while they waited on the shingle with hooks and lanterns. They had her cargo up the beach before the tide turned. Forty souls aboard her. Not one came ashore alive, and I'm not fool enough to think the sea took all of them."

Nessa found she had stopped breathing. Everyone in Ostmark knew the Marigold had been lost with all hands. No one she had ever met said it had been anything but weather.`,
      ),
      action('Nessa asks who gave the order, and whether there is any proof.'),
      narration(
        `"Count Edric Vane gave it. Twelve years in his tomb, and his son sits in the hall now with the same smile." Brannoc rose stiffly, crossed to the shelf where the old logbooks stood in a sagging row, and pulled one free. The page he tore out was brittle and brown, the ink faded to rust: the night's entry, the lamp marked doused in his younger hand, and below it a line in another hand altogether, sealed in green wax with the Vane stag.

He pressed it into her palm and closed her fingers over it. "I've been afraid for thirty years. You're not."

Nessa folded the page into her coat. She would take it to the magistrates' court in Ostmark, she told him, and she would make them read it aloud.`,
      ),
    ],
  ),
  checks: [
    {
      name: 'the wreck is a recounted happening, with its time',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.happenings.some(isRecounted),
    },
    {
      name: 'Nessa learns of the wreck, with learnedAtTurn',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.happenings.some(
          (h) =>
            isRecounted(h) &&
            h.awareness.some((a) => a.ref === 'char_nessa' && a.learnedAtTurn != null),
        ),
    },
    {
      name: 'Brannoc, who watched it, is aware of the wreck',
      kind: 'expect',
      basis: 'judgment',
      holds: (r) =>
        r.happenings.some(
          (h) => isRecounted(h) && h.awareness.some((a) => a.ref === 'char_brannoc'),
        ),
    },
    {
      name: 'Edric Vane is a new character',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => newCharacterNamed(r, /vane/i) != null,
    },
    {
      name: 'Vane, who gave the order, is involved in the wreck',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => {
        const vane = newCharacterNamed(r, /vane/i)
        return vane != null && r.happenings.some((h) => isRecounted(h) && involves(h, vane.handle))
      },
    },
    {
      name: 'Nessa’s resolve to take the page to court is a new thread',
      kind: 'expect',
      basis: 'rule',
      holds: (r) => r.newThreads.length > 0,
    },
    // The page changing hands is left unscored: piggyback records the item and its move, and
    // whether a handover is also a happening is undecided.
    {
      name: 'the telling is not a happening: Nessa learning of the wreck is awareness',
      kind: 'avoid',
      basis: 'judgment',
      holds: (r) =>
        !r.happenings.some(
          (h) =>
            !isRecounted(h) &&
            /\b(tells?|told|telling|recounts?|reveals?|revelation|confess(es|ion)?|account|story|tale|truth|learns?)\b/i.test(
              h.title,
            ),
        ),
    },
    awarenessOfListedOnly(['hap_belltower']),
  ],
  ideal: reply({
    happenings: [
      {
        title: 'The wrecking of the Marigold',
        description:
          'On Count Vane’s order the Calder Point lamp was doused, the Marigold struck the Teeth, and the Count’s men took her cargo while none of her forty came ashore alive.',
        temporal: 'thirty winters ago',
        category: 'a crime',
        icon: 'skull',
        involvements: [
          { ref: 'new:vane', role: 'actor' },
          { ref: 'char_brannoc', role: 'actor' },
          { ref: 'loc_lighthouse', role: 'site' },
        ],
        awareness: [
          { ref: 'char_brannoc', source: 'witnessed it from the gallery', severity: 1 },
          { ref: 'char_nessa', source: 'told by Brannoc', severity: 0.9, learnedAtTurn: 't2' },
        ],
        sourceTurn: 't4',
      },
    ],
    newCharacters: [
      {
        handle: 'new:vane',
        name: 'Edric Vane',
        description: 'The late Count of Ostmark, who ordered the lighthouse lamp doused.',
        keywords: ['the Count'],
        sourceTurn: 't4',
      },
    ],
    newThreads: [
      {
        title: 'Bring the Marigold page before the magistrates',
        description: 'Nessa means to make the court in Ostmark read the logbook page aloud.',
        status: 'active',
        sourceTurn: 't4',
      },
    ],
  }),
  bad: reply({
    aliases: [{ ref: 'c9', terms: ['x'], sourceTurn: 't2' }],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_nessa',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
    ],
    happenings: [
      {
        title: 'Brannoc tells Nessa the truth of the Marigold',
        involvements: [
          { ref: 'char_brannoc', role: 'actor' },
          { ref: 'char_nessa', role: 'target' },
        ],
        awareness: [],
        sourceTurn: 't2',
      },
    ],
  }),
}
