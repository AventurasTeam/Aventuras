import { normalizeTerm } from '@/lib/keyword-terms'

type Awareness = { ref: string; source: string; severity: number; learnedAtTurn?: string }

/**
 * classifier.md → Happenings: a knownAwareness entry naming, by its title, a happening the reply
 * itself adds, and no other, is that happening's own awareness. The planner drops a knownAwareness
 * entry whose happening is no listed one, so moving it keeps the fact. A happening that already
 * lists the character keeps its own entry; any other name, an invented ID or a title two of the
 * reply's happenings share among them, stays as written. Runs on a substituted reply, where one
 * character is one ref however the model wrote it.
 */
export function foldOwnAwareness<
  R extends {
    happenings: readonly { title: string; awareness: readonly Awareness[] }[]
    knownAwareness: readonly (Awareness & { happening: string })[]
  },
>(reply: R): R {
  const happenings = reply.happenings.map((h) => ({ ...h, awareness: [...h.awareness] }))
  const byTitle = new Map<string, (typeof happenings)[number] | null>()
  for (const h of happenings) {
    const title = normalizeTerm(h.title)
    if (title !== '') byTitle.set(title, byTitle.has(title) ? null : h)
  }
  const knownAwareness = reply.knownAwareness.filter(({ happening, ...row }) => {
    const own = byTitle.get(normalizeTerm(happening))
    if (own == null) return true
    if (!own.awareness.some((a) => a.ref === row.ref)) own.awareness.push(row)
    return false
  })
  return { ...reply, happenings, knownAwareness } as R
}
