import { useCallback, useRef, useState } from 'react'
import type { ZodType } from 'zod'

export type ReadSource = 'file' | 'clipboard'

export type FlattenedIssue = { path: string; message: string }

export type ImportState =
  | { kind: 'idle' }
  | { kind: 'reading'; source: ReadSource }
  | { kind: 'meta-error'; copy: string }
  | { kind: 'payload-error'; issues: readonly FlattenedIssue[] }

type EnvelopeOk = { kind: 'ok'; payload: unknown }
type EnvelopeError = { kind: 'error'; copy: string }

type ParseEnvelopeArgs = {
  raw: string
  format: string
  supportedMajor: number
  payloadKey: string
}

const FORMAT_VERSION_PATTERN = /^(\d+)\.(\d+)$/
const PATH_MAX = 40
const MESSAGE_MAX = 80

// Hand-rolled envelope inspection per the spec — keeps meta-failures categorical.
// Folding this into a zod schema would surface meta-errors as payload-shape
// issues, collapsing the meta vs payload distinction we surface to the user.
export function parseEnvelope({
  raw,
  format,
  supportedMajor,
  payloadKey,
}: ParseEnvelopeArgs): EnvelopeOk | EnvelopeError {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'error', copy: '⚠ This file isn’t valid JSON.' }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'error', copy: '⚠ This file isn’t valid JSON.' }
  }
  const env = parsed as Record<string, unknown>

  const parsedFormat = env.format
  if (typeof parsedFormat !== 'string' || !parsedFormat.startsWith('aventuras-')) {
    return { kind: 'error', copy: '⚠ This isn’t an Aventuras file.' }
  }
  if (parsedFormat !== format) {
    return {
      kind: 'error',
      copy: `⚠ This is a different kind of Aventuras file (got ${parsedFormat}, expected ${format}).`,
    }
  }

  const parsedVersion = env.formatVersion
  if (typeof parsedVersion !== 'string' || !FORMAT_VERSION_PATTERN.test(parsedVersion)) {
    return { kind: 'error', copy: '⚠ This file is missing version information.' }
  }
  const major = Number(parsedVersion.split('.')[0])
  if (major < supportedMajor) {
    return { kind: 'error', copy: '⚠ This file is from an older version of Aventuras.' }
  }
  if (major > supportedMajor) {
    return {
      kind: 'error',
      copy: '⚠ This file is from a newer version. Update Aventuras to import.',
    }
  }

  if (!(payloadKey in env)) {
    return { kind: 'error', copy: `⚠ This file is missing its ${payloadKey} data.` }
  }

  return { kind: 'ok', payload: env[payloadKey] }
}

// Path keys joined by `.`; numeric indices wrapped in `[]`. E.g.
// ['calendar', 'units', 0, 'name'] → 'calendar.units[0].name'.
export function joinIssuePath(path: readonly (string | number)[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`
    } else {
      out += out.length === 0 ? segment : `.${segment}`
    }
  }
  return out
}

// Middle-elide path > 40 chars; preserves the head + tail so the user can still
// recognise both the root namespace and the leaf field name.
export function truncatePath(path: string, max: number = PATH_MAX): string {
  if (path.length <= max) return path
  const ellipsis = '…'
  const keep = max - ellipsis.length
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${path.slice(0, head)}${ellipsis}${path.slice(path.length - tail)}`
}

// Tail-elide message > 80 chars. Messages are usually short; this is a safety net
// against verbose `.refine()` error strings the host might supply.
export function truncateMessage(message: string, max: number = MESSAGE_MAX): string {
  if (message.length <= max) return message
  return `${message.slice(0, max - 1)}…`
}

type ZodIssueLike = { path: readonly (string | number | symbol)[]; message: string }

export function flattenIssues(issues: readonly ZodIssueLike[]): FlattenedIssue[] {
  return issues.map((issue) => {
    const numericPath = issue.path.filter((s): s is string | number => typeof s !== 'symbol')
    const fullPath = joinIssuePath(numericPath)
    return {
      path: truncatePath(fullPath),
      message: truncateMessage(issue.message),
    }
  })
}

export function getReadErrorCopy(source: ReadSource, error: unknown): string {
  if (source === 'clipboard') {
    if (error instanceof EmptyClipboardError) return '⚠ Clipboard is empty.'
    return '⚠ Clipboard access denied.'
  }
  return '⚠ Could not read file.'
}

// Sentinel thrown by the clipboard reader when the OS returns an empty string —
// distinguishes "permission OK but nothing copied" from a permission failure.
export class EmptyClipboardError extends Error {
  constructor() {
    super('Clipboard is empty.')
    this.name = 'EmptyClipboardError'
  }
}

// Sentinel thrown by the file reader when the user cancels the picker. The hook
// silently returns to idle on this — cancel isn't an error to surface.
export class FilePickerCancelledError extends Error {
  constructor() {
    super('File picker cancelled.')
    this.name = 'FilePickerCancelledError'
  }
}

type UseImportPipelineArgs<T> = {
  format: string
  supportedMajor: number
  payloadKey: string
  schema: ZodType<T>
  onSuccess: (payload: T) => void
  /** Test seam — Storybook forces specific states for visual coverage. */
  _initialState?: ImportState
}

export type ImportPipelineApi = {
  state: ImportState
  reset: () => void
  runPipeline: (source: ReadSource, read: () => Promise<string>) => Promise<void>
}

// Manages the read → parse-meta → zod-validate pipeline. Async safety: every
// settle compares its requestId against the current one, so a still-in-flight
// read whose user has since cancelled / re-clicked never overwrites the newer
// state.
export function useImportPipeline<T>({
  format,
  supportedMajor,
  payloadKey,
  schema,
  onSuccess,
  _initialState = { kind: 'idle' },
}: UseImportPipelineArgs<T>): ImportPipelineApi {
  const [state, setState] = useState<ImportState>(_initialState)
  const requestIdRef = useRef(0)

  const reset = useCallback(() => {
    requestIdRef.current += 1
    setState({ kind: 'idle' })
  }, [])

  const runPipeline = useCallback(
    async (source: ReadSource, read: () => Promise<string>) => {
      const id = ++requestIdRef.current
      setState({ kind: 'reading', source })

      let raw: string
      try {
        raw = await read()
      } catch (error) {
        if (id !== requestIdRef.current) return
        if (error instanceof FilePickerCancelledError) {
          setState({ kind: 'idle' })
          return
        }
        setState({ kind: 'meta-error', copy: getReadErrorCopy(source, error) })
        return
      }
      if (id !== requestIdRef.current) return

      const envelope = parseEnvelope({ raw, format, supportedMajor, payloadKey })
      if (envelope.kind === 'error') {
        setState({ kind: 'meta-error', copy: envelope.copy })
        return
      }

      const result = schema.safeParse(envelope.payload)
      if (id !== requestIdRef.current) return
      if (!result.success) {
        setState({ kind: 'payload-error', issues: flattenIssues(result.error.issues) })
        return
      }
      onSuccess(result.data)
    },
    [format, supportedMajor, payloadKey, schema, onSuccess],
  )

  return { state, reset, runPipeline }
}
