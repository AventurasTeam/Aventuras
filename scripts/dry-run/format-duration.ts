const UNITS = [
  ['h', 3_600_000],
  ['m', 60_000],
  ['s', 1_000],
] as const

export function formatDuration(ms: number): string {
  let rest = ms
  const parts: string[] = []
  for (const [label, size] of UNITS) {
    const count = Math.floor(rest / size)
    if (count > 0) parts.push(`${count}${label}`)
    rest -= count * size
  }
  return parts.length > 0 ? parts.join(' ') : '0s'
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
