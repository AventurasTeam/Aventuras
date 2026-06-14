/** Wall-clock relative time for the story-list meta row. Both args are unix ms (Date.now()). */
export function formatRelativeTime(thenMs: number | null, nowMs: number): string {
  if (thenMs == null) return 'Never'
  const deltaSec = Math.max(0, Math.floor((nowMs - thenMs) / 1000))
  if (deltaSec < 60) return 'just now'
  const minutes = Math.floor(deltaSec / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
