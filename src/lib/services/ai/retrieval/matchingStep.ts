import type { MatchingStats } from '$lib/utils/text'

function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}

function formatChars(chars: number): string {
  return chars < 1000 ? `${chars} chars` : `${(chars / 1000).toFixed(1)}k chars`
}

/**
 * The activity detail for a Tier 2 keyword-matching run. The saving is an estimate: the checks
 * that reused a haystack, each priced at the run's own average normalization.
 */
export function matchingStepDetail(stats: MatchingStats): string {
  const parts = [`${stats.checks} checks`, formatMs(stats.elapsedMs)]
  if (stats.normalizations > 0) {
    parts.push(`${formatChars(stats.normalizedChars)} normalized ${stats.normalizations}×`)
    const reused = stats.checks - stats.normalizations
    if (reused > 0) {
      const saved = reused * (stats.normalizeMs / stats.normalizations)
      parts.push(`memo saved ~${formatMs(saved)} (est.)`)
    }
  }
  return parts.join(' · ')
}
