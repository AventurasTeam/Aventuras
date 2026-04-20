/**
 * Persistent cache layer for model health pings.
 * TTL is provider-specific (PING_TTL_AUTO_MS / PING_TTL_MANUAL_MS), falling
 * back to PING_TTL_DEFAULT_MS. Wraps DatabaseService methods so callers
 * deal with PingResult / CachedHealth types instead of raw rows.
 */

import { database } from './database'
import {
  PING_TTL_DEFAULT_MS,
  type CachedHealth,
  type HealthStatus,
  type PingResult,
} from '$lib/constants/modelHealth'

export function isFresh(checkedAt: number, ttlMs = PING_TTL_DEFAULT_MS): boolean {
  return Date.now() - checkedAt < ttlMs
}

export async function getAllForKey(
  providerId: string,
  apiKeyHash: string,
): Promise<Map<string, CachedHealth>> {
  const rows = await database.getModelHealthForKey(providerId, apiKeyHash)
  const out = new Map<string, CachedHealth>()
  for (const r of rows) {
    out.set(r.model_id, {
      status: r.status as HealthStatus,
      httpCode: r.http_code,
      latencyMs: r.latency_ms,
      quotaPercent: r.quota_percent,
      checkedAt: r.checked_at,
    })
  }
  return out
}

export interface UpsertRow {
  providerId: string
  modelId: string
  apiKeyHash: string
  result: PingResult
  checkedAt: number
}

export async function upsertBatch(rows: UpsertRow[]): Promise<void> {
  if (rows.length === 0) return
  await database.upsertModelHealthBatch(
    rows.map((r) => ({
      providerId: r.providerId,
      modelId: r.modelId,
      apiKeyHash: r.apiKeyHash,
      status: r.result.status,
      httpCode: r.result.httpCode,
      latencyMs: r.result.latencyMs,
      quotaPercent: r.result.quotaPercent,
      checkedAt: r.checkedAt,
    })),
  )
}

export async function deleteModelHealthForKey(
  providerId: string,
  apiKeyHash: string,
): Promise<void> {
  await database.deleteModelHealthForKey(providerId, apiKeyHash)
}
