import type { ClassifierExtraction } from '@/lib/classifier'

import type { Check } from './fixture'

type ReplyHappening = ClassifierExtraction['happenings'][number]

export const involves = (h: ReplyHappening, ref: string): boolean =>
  h.involvements.some((i) => i.ref === ref)

export const isRecounted = (h: ReplyHappening): boolean => (h.temporal?.trim() ?? '') !== ''

export const newCharacterNamed = (reply: ClassifierExtraction, name: RegExp) =>
  reply.newCharacters.find((c) => name.test(c.name))

// An unknown turn falls back to the window head, after every turn.
const turnIndex = (turn: string | undefined): number => {
  const match = /^t(\d+)$/.exec(turn ?? '')
  return match == null ? Infinity : Number(match[1])
}

/** The faction a character ends with: the planner applies memberships in turn order, then reply
 *  order, so the last one stands. Undefined when the reply sets none. */
export const factionAfter = (
  reply: ClassifierExtraction,
  character: string,
): string | null | undefined =>
  reply.memberships
    .map((m, order) => ({ m, order, at: turnIndex(m.sourceTurn) }))
    .filter(({ m }) => m.character === character)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .at(-1)?.m.faction

export const awarenessOfListedOnly = (listed: readonly string[]): Check => ({
  name: 'knownAwareness names only a listed happening',
  kind: 'avoid',
  basis: 'rule',
  holds: (r) => r.knownAwareness.every((k) => listed.includes(k.happening)),
})
