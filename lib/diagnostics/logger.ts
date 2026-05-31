import { getCurrentActionId } from './ambient-action-id'
import { isDiagnosticsDebugEnabled, isDiagnosticsEnabled } from './gate'
import { EVENT_NAME_REGEX, eventNameOf, type LogKind } from './kinds'
import { diagnosticsStore } from './store'
import type { LogEntry, LogLevel } from './types'
import { ulid } from './ulid'

// Run dev-only drift checks unless this is explicitly a production build. Node
// (vitest) leaves __DEV__ undefined, so the check runs there too.
const runDriftCheck = typeof __DEV__ === 'undefined' || __DEV__

type LogOpts = { actionId?: string }
type LogFn = (kind: LogKind, fields?: Record<string, unknown>, opts?: LogOpts) => void
type Logger = { error: LogFn; warn: LogFn; debug: LogFn }

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
    id: ulid(),
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

function makeLogger(resolveActionId: () => string | undefined): Logger {
  return {
    error: (kind, fields = {}, opts) =>
      emit('error', kind, fields, opts?.actionId ?? resolveActionId()),
    warn: (kind, fields = {}, opts) =>
      emit('warn', kind, fields, opts?.actionId ?? resolveActionId()),
    debug: (kind, fields = {}, opts) =>
      emit('debug', kind, fields, opts?.actionId ?? resolveActionId()),
  }
}

export const logger = makeLogger(getCurrentActionId)
export const loggerWithoutTurn = makeLogger(() => undefined)
