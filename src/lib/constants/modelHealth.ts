export const PING_TTL_DEFAULT_MS = 30 * 60 * 1000

export const PING_TTL_AUTO_MS: Record<string, number> = {
  openrouter: 30 * 60 * 1000,
  'nvidia-nim': 15 * 60 * 1000,
}
export const PING_TTL_MANUAL_MS: Record<string, number> = {
  openrouter: 10 * 60 * 1000,
  'nvidia-nim': 5 * 60 * 1000,
}
export const PING_TIMEOUT_MS = 10_000
export const PING_CONCURRENCY = 5
export const HEALTHY_THRESHOLD_MS = 3000

export type HealthStatus = 'ok' | 'slow' | 'down' | 'auth' | 'rate_limited'

export interface PingResult {
  status: HealthStatus
  httpCode: number | null
  latencyMs: number | null
  quotaPercent: number | null
}

export interface CachedHealth extends PingResult {
  checkedAt: number
}

export const PING_ELIGIBLE_PROVIDERS = ['openrouter', 'nvidia-nim'] as const

export type PingEligibleProvider = (typeof PING_ELIGIBLE_PROVIDERS)[number]

export function isPingEligibleProvider(
  providerType: string | undefined | null,
): providerType is PingEligibleProvider {
  return !!providerType && (PING_ELIGIBLE_PROVIDERS as readonly string[]).includes(providerType)
}
