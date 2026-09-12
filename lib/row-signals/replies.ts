import type { SignalEntry } from './types'

/**
 * The last two `ai_reply` entries (skipping `system`), latest first, each paired
 * with the entry just before it. Delta tiers and scene tiers must pick the same two.
 */
export function lastTwoReplies(
  entries: readonly SignalEntry[],
): { reply: SignalEntry; before: SignalEntry | null }[] {
  const narrative = entries.filter((e) => e.kind !== 'system')
  const out: { reply: SignalEntry; before: SignalEntry | null }[] = []
  for (let i = narrative.length - 1; i >= 0 && out.length < 2; i--) {
    if (narrative[i].kind !== 'ai_reply') continue
    out.push({ reply: narrative[i], before: narrative[i - 1] ?? null })
  }
  return out
}
