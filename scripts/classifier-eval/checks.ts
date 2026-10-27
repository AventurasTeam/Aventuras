import type { ClassifierExtraction } from '@/lib/classifier'

import type { Check } from './fixture'

type ReplyHappening = ClassifierExtraction['happenings'][number]

export const involves = (h: ReplyHappening, ref: string): boolean =>
  h.involvements.some((i) => i.ref === ref)

export const isRecounted = (h: ReplyHappening): boolean => (h.temporal?.trim() ?? '') !== ''

export const newCharacterNamed = (reply: ClassifierExtraction, name: RegExp) =>
  reply.newCharacters.find((c) => name.test(c.name))

export const awarenessOfListedOnly = (listed: readonly string[]): Check => ({
  name: 'knownAwareness names only a listed happening',
  kind: 'avoid',
  basis: 'rule',
  holds: (r) => r.knownAwareness.every((k) => listed.includes(k.happening)),
})
