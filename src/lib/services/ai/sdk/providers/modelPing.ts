/**
 * Model availability ping.
 *
 * Sends a minimal `chat/completions` request (max_tokens: 1) and reports
 * status + latency. Uses the raw Tauri HTTP fetch (NOT createTimeoutFetch)
 * because we don't want debug logging / response patching / manual-body
 * injection on these probes.
 */

import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { PROVIDERS } from './config'
import type { APIProfile } from '$lib/types'
import {
  HEALTHY_THRESHOLD_MS,
  PING_TIMEOUT_MS,
  type HealthStatus,
  type PingResult,
} from '$lib/constants/modelHealth'

export function getEffectiveBaseUrl(profile: APIProfile): string {
  const fromProfile = profile.baseUrl?.trim()
  if (fromProfile) return normalizeBaseUrl(fromProfile)
  const fallback = PROVIDERS[profile.providerType]?.baseUrl
  return fallback ? normalizeBaseUrl(fallback) : ''
}

function classify(httpCode: number, latencyMs: number, quota: number | null): PingResult {
  if (httpCode === 401 || httpCode === 403) {
    return { status: 'auth', httpCode, latencyMs, quotaPercent: quota }
  }
  if (httpCode === 429) {
    return { status: 'rate_limited', httpCode, latencyMs, quotaPercent: quota }
  }
  if (httpCode >= 200 && httpCode < 300) {
    // Latency >= PING_TIMEOUT_MS is unreachable: the AbortController fires first → catch branch.
    const status: HealthStatus = latencyMs < HEALTHY_THRESHOLD_MS ? 'ok' : 'slow'
    return { status, httpCode, latencyMs, quotaPercent: quota }
  }
  return { status: 'down', httpCode, latencyMs, quotaPercent: quota }
}

function getHeaderValue(headers: Headers, key: string): string | null {
  return headers.get(key) ?? headers.get(key.toLowerCase())
}

export function extractQuotaPercent(headers: Headers): number | null {
  const variants: Array<[string, string]> = [
    ['x-ratelimit-remaining', 'x-ratelimit-limit'],
    ['x-ratelimit-remaining-requests', 'x-ratelimit-limit-requests'],
    ['ratelimit-remaining', 'ratelimit-limit'],
    ['ratelimit-remaining-requests', 'ratelimit-limit-requests'],
  ]
  for (const [remKey, limKey] of variants) {
    const remaining = parseFloat(getHeaderValue(headers, remKey) ?? '')
    const limit = parseFloat(getHeaderValue(headers, limKey) ?? '')
    if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
      const pct = Math.round((remaining / limit) * 100)
      return Math.max(0, Math.min(100, pct))
    }
  }
  return null
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export async function pingModel(
  baseUrl: string,
  apiKey: string,
  modelId: string,
): Promise<PingResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PING_TIMEOUT_MS)
  const t0 = performance.now()
  try {
    const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`
    const resp = await tauriHttpFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false,
      }),
      signal: ctrl.signal,
    })
    const ms = Math.round(performance.now() - t0)
    try {
      if (resp.status >= 400 && resp.status < 500) {
        try {
          const body = await resp.text()
          console.warn(`[modelPing] ${modelId} → HTTP ${resp.status}`, body)
        } catch {
          // ignore body read errors
        }
      }
      return classify(resp.status, ms, extractQuotaPercent(resp.headers))
    } finally {
      // Always release the body stream, regardless of read success.
      // If resp.text() already consumed it, cancel() is a no-op.
      resp.body?.cancel().catch(() => {})
    }
  } catch {
    return { status: 'down', httpCode: null, latencyMs: null, quotaPercent: null }
  } finally {
    clearTimeout(timer)
  }
}
