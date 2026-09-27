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
