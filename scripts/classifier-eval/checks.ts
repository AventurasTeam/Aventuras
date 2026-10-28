import type { ClassifierExtraction } from '@/lib/classifier'

import type { Check, EvalWindow } from './fixture'

type ReplyHappening = ClassifierExtraction['happenings'][number]

export const involves = (h: ReplyHappening, ref: string): boolean =>
  h.involvements.some((i) => i.ref === ref)

export const isRecounted = (h: ReplyHappening): boolean => (h.temporal?.trim() ?? '') !== ''

/** The new characters the planner creates: it plans nothing for a blank name. */
export const createdCharacters = (reply: ClassifierExtraction) =>
  reply.newCharacters.filter((c) => c.name.trim() !== '')

export const newCharacterNamed = (reply: ClassifierExtraction, name: RegExp) =>
  createdCharacters(reply).find((c) => name.test(c.name))

// An unknown turn falls back to the window head, after every turn.
const turnIndex = (turn: string | undefined): number => {
  const match = /^t(\d+)$/.exec(turn ?? '')
  return match == null ? Infinity : Number(match[1])
}

/** The faction a character holding `held` ends with, as the planner applies memberships: in turn
 *  order, then reply order, but a none first at a turn that also joins a faction other than the one
 *  held, a change of sides. Undefined when the reply sets none. */
export const factionAfter = (
  reply: ClassifierExtraction,
  character: string,
  held: string | null,
): string | null | undefined => {
  const facts = reply.memberships
    .map((m, order) => ({ m, order, at: turnIndex(m.sourceTurn) }))
    .filter(({ m }) => m.character === character)
    .sort((a, b) => a.at - b.at || a.order - b.order)
  let current: string | null | undefined = undefined
  let before = held
  for (const at of new Set(facts.map((f) => f.at))) {
    const turn = facts.filter((f) => f.at === at).map((f) => f.m.faction)
    const switching =
      before != null && turn.includes(null) && turn.some((f) => f !== null && f !== before)
    const ordered = switching
      ? [...turn.filter((f) => f === null), ...turn.filter((f) => f !== null)]
      : turn
    for (const faction of ordered) current = before = faction
  }
  return current
}

export const awarenessOfListedOnly = (listed: readonly string[]): Check => ({
  name: 'knownAwareness names only a listed happening',
  kind: 'avoid',
  basis: 'rule',
  holds: (r) => r.knownAwareness.every((k) => listed.includes(k.happening)),
})

const referencesOf = (r: ClassifierExtraction): string[] => [
  ...r.happenings.flatMap((h) => [
    ...h.involvements.map((i) => i.ref),
    ...h.awareness.map((a) => a.ref),
  ]),
  ...r.relationships.flatMap((x) => [x.subject, x.object]),
  ...r.statusFlips.map((f) => f.ref),
  ...r.memberships.flatMap((m) => (m.faction == null ? [m.character] : [m.character, m.faction])),
  ...r.aliases.map((a) => a.ref),
  ...r.renames.map((n) => n.ref),
  ...r.placements.flatMap((p) => (p.parent === 'top-level' ? [p.ref] : [p.ref, p.parent])),
  ...r.standings.map((s) => s.ref),
  ...r.threadStatuses.map((t) => t.thread),
  ...r.knownAwareness.map((k) => k.ref),
]

/** Every ID a reply names is a row its window lists or a handle the reply declares: an invented
 *  handle drops the fact that uses it. A knownAwareness happening is awarenessOfListedOnly's. */
export const refsResolve = (w: Pick<EvalWindow, 'entities' | 'happenings' | 'threads'>): Check => {
  const listed = new Set([...w.entities, ...w.happenings, ...w.threads].map((row) => row.id))
  return {
    name: 'every ID names a listed row or a handle the reply declares',
    kind: 'avoid',
    basis: 'rule',
    holds: (r) => {
      const declared = new Set([
        ...r.newCharacters.map((c) => c.handle),
        ...r.newFactions.map((f) => f.handle),
      ])
      return referencesOf(r).every((ref) => listed.has(ref) || declared.has(ref))
    },
  }
}
