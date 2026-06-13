/** Wall-clock relative time for the story-list meta row. Both args in seconds. */
export function formatRelativeTime(thenSec: number | null, nowSec: number): string {
  if (thenSec == null) return 'Never'
  const delta = Math.max(0, nowSec - thenSec)
  if (delta < 60) return 'just now'
  const minutes = Math.floor(delta / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
