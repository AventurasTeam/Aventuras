import type { RollbackCounts } from '@/lib/actions'

export type RegenerateGate = 'immediate' | 'cascade-confirm' | 'chapter-close-confirm'

// counts.entries === 1 ⇔ the reply is terminal: system entries and the opening
// carry no create deltas, so only later non-system entries can raise the count.
// The chapter-close arm is dormant until M5.2 (no chapter close exists in M3);
// it is named here so the cost-confirm lands without touching the common path.
export function classifyRegenerateGate(counts: RollbackCounts): RegenerateGate {
  if (counts.chapters > 0) return 'chapter-close-confirm'
  return counts.entries === 1 ? 'immediate' : 'cascade-confirm'
}
