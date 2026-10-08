import { describe, expect, it } from 'vitest'

import { i18n, t } from '@/lib/i18n'

import {
  EmptyClipboardError,
  flattenIssues,
  formatIssueLine,
  getReadErrorCopy,
  joinIssuePath,
  parseEnvelope,
  truncateMessage,
  truncatePath,
} from './import-dialog-pipeline'

const STORY_FORMAT = 'aventuras-story'
const CALENDAR_FORMAT = 'aventuras-calendar'
const STORY_KEY = 'story'

function visible(copy: string): string {
  return copy.replaceAll('\u2060', '')
}

function envelope(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    format: STORY_FORMAT,
    formatVersion: '1.0',
    [STORY_KEY]: { title: 'Untitled' },
    ...overrides,
  })
}

function parse(raw: string) {
  return parseEnvelope({ raw, format: STORY_FORMAT, supportedMajor: 1, payloadKey: STORY_KEY })
}

describe('parseEnvelope', () => {
  it('returns the payload sub-object on a well-formed envelope', () => {
    expect(parse(envelope())).toEqual({ kind: 'ok', payload: { title: 'Untitled' } })
  })

  it('flags non-JSON input as an invalid-JSON meta-error', () => {
    expect(parse('not json {')).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.invalidJson'),
    })
  })

  it('flags an array root as invalid JSON (envelope must be a plain object)', () => {
    expect(parse('[1,2,3]')).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.invalidJson'),
    })
  })

  it('flags missing format as not-an-Aventuras-file', () => {
    expect(parse(JSON.stringify({ hello: 'world' }))).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.notAventuras'),
    })
  })

  it('flags non-aventuras format prefix as not-an-Aventuras-file', () => {
    expect(parse(JSON.stringify({ format: 'something-else', formatVersion: '1.0' }))).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.notAventuras'),
    })
  })

  it('flags format mismatch with both expected and got values in the copy', () => {
    const result = parse(envelope({ format: CALENDAR_FORMAT }))
    expect(result).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.wrongKind', {
        got: CALENDAR_FORMAT,
        expected: STORY_FORMAT,
      }),
    })
    if (result.kind !== 'error') return
    expect(result.copy).toContain(STORY_FORMAT)
    expect(result.copy).toContain(CALENDAR_FORMAT)
  })

  it.each(['aventuras-{{expected}}', 'aventuras-{{{expected}}}'])(
    'shows the file’s format %s verbatim in the wrong-kind copy',
    (got) => {
      const result = parse(envelope({ format: got }))
      if (result.kind !== 'error') throw new Error('expected a meta-error')
      expect(visible(result.copy)).toBe(
        `This is a different kind of Aventuras file (got ${got}, expected aventuras-story).`,
      )
      expect(result.copy).not.toContain('{{')
    },
  )

  it('enforces case-sensitive format match', () => {
    // 'Aventuras-Story' doesn't start with 'aventuras-' (case-sensitive),
    // so it falls into the not-an-Aventuras-file branch rather than mismatch.
    expect(parse(envelope({ format: 'Aventuras-Story' }))).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.notAventuras'),
    })
  })

  it('rejects single-component or v-prefixed versions', () => {
    for (const bad of ['1', '1.0.0', 'v1.0', '', 'major.minor']) {
      expect(parse(envelope({ formatVersion: bad }))).toEqual({
        kind: 'error',
        copy: t('common:importDialog.meta.missingVersion'),
      })
    }
  })

  it('flags older-major as older-version meta-error', () => {
    expect(parse(envelope({ formatVersion: '0.9' }))).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.olderVersion'),
    })
  })

  it('flags newer-major as newer-version meta-error', () => {
    expect(parse(envelope({ formatVersion: '2.0' }))).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.newerVersion'),
    })
  })

  it('accepts higher-minor on the supported major (forward-compat strip behavior)', () => {
    expect(parse(envelope({ formatVersion: '1.5' })).kind).toBe('ok')
  })

  it('flags missing payload key with the key name in the copy', () => {
    const result = parse(JSON.stringify({ format: STORY_FORMAT, formatVersion: '1.0' }))
    expect(result).toEqual({
      kind: 'error',
      copy: t('common:importDialog.meta.missingPayload', { payloadKey: STORY_KEY }),
    })
    if (result.kind !== 'error') return
    expect(result.copy).toContain(STORY_KEY)
  })

  it('resolves its copy when the check fails, in the language active then', async () => {
    i18n.addResource('fr', 'common', 'importDialog.meta.invalidJson', 'Pas un JSON valide.')
    await i18n.changeLanguage('fr')
    try {
      expect(parse('not json {')).toEqual({ kind: 'error', copy: 'Pas un JSON valide.' })
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})

describe('joinIssuePath', () => {
  it('joins string keys with dots', () => {
    expect(joinIssuePath(['calendar', 'eras'])).toBe('calendar.eras')
  })

  it('wraps numeric indices in brackets without leading dot', () => {
    expect(joinIssuePath(['calendar', 'units', 0, 'name'])).toBe('calendar.units[0].name')
  })

  it('handles a leading numeric index without a leading dot', () => {
    expect(joinIssuePath([0, 'name'])).toBe('[0].name')
  })

  it('returns empty string on an empty path', () => {
    expect(joinIssuePath([])).toBe('')
  })
})

describe('truncatePath', () => {
  it('passes paths shorter than the cap through unchanged', () => {
    expect(truncatePath('calendar.eras', 40)).toBe('calendar.eras')
  })

  it('middle-elides long paths preserving head + tail', () => {
    const long = 'calendar.units[0].name.subfield.deeplyNestedField'
    const out = truncatePath(long, 20)
    expect(out.length).toBe(20)
    expect(out).toContain('…')
    expect(out.startsWith('calendar')).toBe(true)
    expect(out.endsWith('Field')).toBe(true)
  })
})

describe('truncateMessage', () => {
  it('passes short messages through', () => {
    expect(truncateMessage('required', 80)).toBe('required')
  })

  it('tail-elides long messages', () => {
    const long = 'a'.repeat(200)
    const out = truncateMessage(long, 80)
    expect(out.length).toBe(80)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('flattenIssues', () => {
  it('drops symbol-typed path segments (zod internal sentinels)', () => {
    const issues = [{ path: ['calendar', Symbol('weird'), 'name'], message: 'required' }]
    const out = flattenIssues(issues)
    expect(out[0]?.path).toBe('calendar.name')
  })

  it('applies path + message truncation in one pass', () => {
    const issues = [
      {
        path: ['root', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'leaf'],
        message: 'x'.repeat(100),
      },
    ]
    const out = flattenIssues(issues)
    expect(out[0]?.path.length).toBeLessThanOrEqual(40)
    expect(out[0]?.message.length).toBeLessThanOrEqual(80)
  })
})

describe('formatIssueLine', () => {
  function lineFor(path: (string | number)[], message: string): string {
    const [issue] = flattenIssues([{ path, message }])
    if (!issue) throw new Error('flattenIssues dropped the issue')
    return formatIssueLine(issue)
  }

  it('renders a plain issue as the canon line', () => {
    expect(lineFor(['kind'], 'Expected a character.')).toBe('kind — Expected a character.')
  })

  it.each([
    [' {{message}} ', 'state.stackables. {{message}}  — This quantity is listed twice.'],
    ['{{{message}}}', 'state.stackables.{{{message}}} — This quantity is listed twice.'],
  ])('shows the file key %j verbatim in the issue line', (key, line) => {
    const out = lineFor(['state', 'stackables', key], 'This quantity is listed twice.')
    expect(visible(out)).toBe(line)
    expect(out).not.toContain('{{')
  })

  it('shows file text in the message verbatim when a locale puts the message first', async () => {
    i18n.addResource('fr', 'common', 'importDialog.issue', '{{message}} ({{path}})')
    await i18n.changeLanguage('fr')
    try {
      const out = lineFor(['kind'], 'Unrecognized key: "{{path}}"')
      expect(visible(out)).toBe('Unrecognized key: "{{path}}" (kind)')
      expect(out).not.toContain('{{')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})

describe('getReadErrorCopy', () => {
  it('returns the file-read copy for the file source', () => {
    expect(getReadErrorCopy('file', new Error('I/O'))).toBe(
      t('common:importDialog.read.fileFailed'),
    )
  })

  it('returns the empty-clipboard copy when the sentinel is thrown', () => {
    expect(getReadErrorCopy('clipboard', new EmptyClipboardError())).toBe(
      t('common:importDialog.read.clipboardEmpty'),
    )
  })

  it('returns access-denied for generic clipboard failures', () => {
    expect(getReadErrorCopy('clipboard', new Error('permission'))).toBe(
      t('common:importDialog.read.clipboardDenied'),
    )
  })
})

// import-dialog.md → Validation pipeline / Dialog body: English copy, minus the banner's ⚠.
const CANON_COPY = [
  ['common:importDialog.chooseFile', 'Choose .avts file…'],
  ['common:importDialog.fromClipboard', 'Import from clipboard'],
  ['common:importDialog.clipboardUnavailable', 'Clipboard access not available.'],
  ['common:importDialog.hint', '.avts and .json files supported.'],
  ['common:importDialog.showDetails', 'Show details'],
  ['common:importDialog.hideDetails', 'Hide details'],
  ['common:importDialog.read.fileFailed', 'Could not read file.'],
  ['common:importDialog.read.clipboardDenied', 'Clipboard access denied.'],
  ['common:importDialog.read.clipboardEmpty', 'Clipboard is empty.'],
  ['common:importDialog.meta.invalidJson', 'This file isn’t valid JSON.'],
  ['common:importDialog.meta.notAventuras', 'This isn’t an Aventuras file.'],
  ['common:importDialog.meta.missingVersion', 'This file is missing version information.'],
  ['common:importDialog.meta.olderVersion', 'This file is from an older version of Aventuras.'],
  [
    'common:importDialog.meta.newerVersion',
    'This file is from a newer version. Update Aventuras to import.',
  ],
] as const

// `t` is typed to literal keys; this table's keys are what the assertions check.
const tKey = t as unknown as (key: string) => string

describe('importDialog copy', () => {
  it.each(CANON_COPY)('%s reads as the canon line', (key, line) => {
    expect(tKey(key)).toBe(line)
  })

  it('interpolates the wrong-kind, missing-payload and issue lines', () => {
    expect(
      t('common:importDialog.meta.wrongKind', {
        got: 'aventuras-story',
        expected: 'aventuras-calendar',
      }),
    ).toBe(
      'This is a different kind of Aventuras file (got aventuras-story, expected aventuras-calendar).',
    )
    expect(t('common:importDialog.meta.missingPayload', { payloadKey: 'entity' })).toBe(
      'This file is missing its entity data.',
    )
    expect(t('common:importDialog.issue', { path: 'kind', message: 'Expected a character.' })).toBe(
      'kind — Expected a character.',
    )
  })

  it('pluralizes the payload-error summary', () => {
    expect(t('common:importDialog.invalidFormat', { count: 1 })).toBe('Invalid format — 1 issue.')
    expect(t('common:importDialog.invalidFormat', { count: 3 })).toBe('Invalid format — 3 issues.')
  })
})
