import { generateId } from '@/lib/ids'

import { EVENT_NAME_REGEX, eventNameOf, type LogKind } from '../kinds'
import type { LogEntry, LogLevel } from '../types'
import { isDiagnosticsDebugEnabled, isDiagnosticsEnabled } from './gate'
import { diagnosticsStore } from './store'

// Run dev-only drift checks unless this is explicitly a production build. Node
// (vitest) leaves __DEV__ undefined, so the check runs there too.
const runDriftCheck = typeof __DEV__ === 'undefined' || __DEV__

type LogOpts = { actionId?: string }
type LogFn = (kind: LogKind, fields?: Record<string, unknown>, opts?: LogOpts) => void
export type Logger = { error: LogFn; warn: LogFn; debug: LogFn }

function emit(
  level: LogLevel,
  kind: LogKind,
  fields: Record<string, unknown>,
  actionId: string | undefined,
): void {
  if (!isDiagnosticsEnabled()) return
  if (level === 'debug' && !isDiagnosticsDebugEnabled()) return

  const state = diagnosticsStore.getState()
  if (runDriftCheck && !EVENT_NAME_REGEX.test(eventNameOf(kind))) {
    console.warn(
      `[diagnostics] log kind "${kind}" has a non-snake_case event name (expected /^[a-z][a-z0-9_]*$/).`,
    )
  }

  const entry: LogEntry = {
    id: generateId('log'),
    emittedAt: Date.now(),
    level,
    kind,
    fields,
    ...(actionId !== undefined ? { actionId } : {}),
  }
  state.pushLog(entry)

  // Mirror after the store write; swallow mirror failures (spec).
  try {
    console[level](kind, fields)
  } catch {
    /* console may be unavailable in some embedded WebViews */
  }
}

export function makeLogger(actionId?: string): Logger {
  return {
    error: (kind, fields = {}, opts) => emit('error', kind, fields, opts?.actionId ?? actionId),
    warn: (kind, fields = {}, opts) => emit('warn', kind, fields, opts?.actionId ?? actionId),
    debug: (kind, fields = {}, opts) => emit('debug', kind, fields, opts?.actionId ?? actionId),
  }
}

export const logger = makeLogger()
