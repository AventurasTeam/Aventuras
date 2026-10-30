import { awarenessOfListedOnly, involves } from '../checks'
import { action, character, entries, narration, place, reply, type EvalWindow } from '../fixture'

// Creative mode, third person, no lead. The user's first turn is a direction the narration carries
// out otherwise: she tells the truth. The second is written as prose, and it is part of the story.
const said = (h: { title: string; description?: string | null }) =>
  `${h.title} ${h.description ?? ''}`

export const direction: EvalWindow = {
  name: 'direction',
  about:
    'a creative story: a direction the narration carries out otherwise, then a turn written as prose',
  mode: 'creative',
  entities: [
    character('char_kael', 'Kael', { description: 'A courier, back from the river road.' }),
    character('char_aria', 'Aria', { description: 'His younger sister, who keeps the inn.' }),
    place('loc_inn', 'The Lantern Inn', {
      description: 'A riverside inn, shuttered for the night.',
    }),
  ],
  happenings: [],
  relationships: [],
  threads: [],
  entries: entries('direction', { scene: ['char_kael', 'char_aria'], location: 'loc_inn' }, [
    action(
      'Kael confronts Aria about the letter he found in her coat, and she lies to him about who wrote it.',
    ),
    narration(
      `Kael set the letter on the table between them, its seal broken. "This was in your coat," he said. "Who's writing to you from Varn?"

Aria looked at it for a long moment, then sat down across from him. "No one's writing to me. I wrote it, and I never sent it." She turned the page so he could see the hand, her own, cramped and careful. "It's to our mother. I found out where she is, Kael. I've known since spring."

He said nothing. Outside, the rain came harder against the shutters.`,
    ),
    action(
      'The rain kept on. When Kael finally went up to bed, Aria fed the letter to the fire and watched the pages curl.',
    ),
    narration(
      `She stayed by the hearth until the last of it had gone to ash. Then she took a fresh sheet from the drawer under the counter, dipped her pen, and began again: Mother.`,
    ),
  ]),
  checks: [
    {
      name: 'no happening says Aria lied, which only the direction asked for',
      kind: 'avoid',
      basis: 'rule',
      holds: (r) => !r.happenings.some((h) => /\bli(e|es|ed)\b|lying|deceiv/i.test(said(h))),
    },
    {
      name: 'the confrontation tells what the narration made of it: she wrote it to their mother',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.happenings.some(
          (h) =>
            involves(h, 'char_kael') &&
            involves(h, 'char_aria') &&
            /mother/i.test(said(h)) &&
            (/\b(she|aria|herself)\b[^.]*\b(wrote|written|writes|penned)\b/i.test(said(h)) ||
              /\b(written|penned)\s+by\s+(her|aria)\b/i.test(said(h))),
        ),
    },
    {
      name: 'the burning, from the turn written as prose, is recorded',
      kind: 'expect',
      basis: 'rule',
      // The prose turn, or the narration that finishes it: a fact synthesised across turns takes
      // the latest.
      holds: (r) =>
        r.happenings.some(
          (h) => /burn|fire|ash|flame/i.test(said(h)) && ['t3', 't4'].includes(h.sourceTurn ?? ''),
        ),
    },
    {
      name: 'Kael knows of the confrontation',
      kind: 'expect',
      basis: 'rule',
      holds: (r) =>
        r.happenings.some(
          (h) => /mother/i.test(said(h)) && h.awareness.some((a) => a.ref === 'char_kael'),
        ),
    },
    awarenessOfListedOnly([]),
  ],
  ideal: reply({
    happenings: [
      {
        title: 'Kael confronts Aria about the letter',
        description:
          'Kael confronts Aria with a letter he found in her coat. She tells him she wrote it herself, to their mother, whom she has known how to find since spring, and never sent it.',
        category: 'a confrontation',
        involvements: [
          { ref: 'char_kael', role: 'actor' },
          { ref: 'char_aria', role: 'target' },
          { ref: 'loc_inn', role: 'site' },
        ],
        awareness: [
          { ref: 'char_kael', source: 'took part', severity: 0.7 },
          { ref: 'char_aria', source: 'took part', severity: 0.7 },
        ],
        sourceTurn: 't2',
      },
      {
        title: 'Aria burns the letter',
        description:
          'After Kael goes up to bed, Aria burns the letter in the hearth and begins another to their mother.',
        category: 'a secret',
        involvements: [
          { ref: 'char_aria', role: 'actor' },
          { ref: 'loc_inn', role: 'site' },
        ],
        awareness: [{ ref: 'char_aria', source: 'did it', severity: 0.5 }],
        sourceTurn: 't4',
      },
    ],
  }),
  bad: reply({
    happenings: [
      {
        title: 'Aria lies about the letter',
        description: 'Kael confronts Aria about a letter, and she lies to him about who wrote it.',
        category: 'a deception',
        involvements: [
          { ref: 'char_kael', role: 'actor' },
          { ref: 'char_aria', role: 'target' },
          { ref: 'c9', role: 'witness' },
        ],
        awareness: [],
        sourceTurn: 't1',
      },
    ],
    knownAwareness: [
      {
        happening: 'hap_unlisted',
        ref: 'char_kael',
        source: 'x',
        severity: 0.5,
        learnedAtTurn: 't2',
      },
    ],
  }),
}
