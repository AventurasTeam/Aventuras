import type { MatchingStats } from '$lib/utils/text'

function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}

function formatChars(chars: number): string {
  return chars < 1000 ? `${chars} chars` : `${(chars / 1000).toFixed(1)}k chars`
}

/**
 * The activity detail for a Tier 2 keyword-matching run. The saving is an estimate: each check
 * that reused a haystack, priced at what that haystack cost to normalize.
 */
export function matchingStepDetail(stats: MatchingStats): string {
  const parts = [`${stats.checks} checks`, formatMs(stats.elapsedMs)]
  if (stats.normalizations > 0) {
    parts.push(`${formatChars(stats.normalizedChars)} normalized ${stats.normalizations}×`)
  }
  if (stats.checks > stats.normalizations) {
    parts.push(`memo saved ~${formatMs(stats.savedMs)} (est.)`)
  }
  return parts.join(' · ')
}
