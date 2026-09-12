import { describe, it, expect } from 'vitest'
import { hashContent } from '../hash'
import {
  DIRECTORY_FORMAT_VERSION,
  parsePackFile,
  parseTemplateFile,
  serializePackFile,
  serializeTemplate,
  type PackFile,
} from './serialize'

const packFile: PackFile = {
  formatVersion: DIRECTORY_FORMAT_VERSION,
  appVersion: '0.7.9',
  source: 'pack',
  name: 'My Pack',
  description: 'A pack',
  author: 'Someone',
  variables: [
    {
      variableName: 'writing_style',
      displayName: 'Writing Style',
      variableType: 'enum',
      isRequired: true,
      sortOrder: 1,
      defaultValue: 'terse',
      enumOptions: [
        { label: 'Terse', value: 'terse' },
        { label: 'Lush', value: 'lush' },
      ],
    },
    {
      variableName: 'aside_frequency',
      displayName: 'Aside Frequency',
      variableType: 'number',
      isRequired: false,
      sortOrder: 0,
    },
  ],
}

describe('serializePackFile', () => {
  it('is byte-identical across two serialisations of the same pack', () => {
    expect(serializePackFile(packFile)).toBe(serializePackFile(packFile))
  })

  it('orders variables by sortOrder then name, whatever order they arrive in', () => {
    const reversed: PackFile = { ...packFile, variables: [...packFile.variables].reverse() }
    expect(serializePackFile(reversed)).toBe(serializePackFile(packFile))

    const yaml = serializePackFile(packFile)
    expect(yaml.indexOf('aside_frequency')).toBeLessThan(yaml.indexOf('writing_style'))
  })

  it('writes the versions and source, and no timestamp', () => {
    const yaml = serializePackFile(packFile)
    expect(yaml).toContain(`formatVersion: ${DIRECTORY_FORMAT_VERSION}`)
    expect(yaml).toContain('appVersion: 0.7.9')
    expect(yaml).toContain('source: pack')
    expect(yaml).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('omits an absent description and author rather than writing null', () => {
    const bare: PackFile = { ...packFile, description: undefined, author: undefined }
    const yaml = serializePackFile(bare)
    expect(yaml).not.toContain('description:')
    expect(yaml).not.toContain('author:')
  })
})

describe('parsePackFile', () => {
  it('round-trips a written file', () => {
    const result = parsePackFile(serializePackFile(packFile))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.name).toBe('My Pack')
      expect(result.value.variables).toHaveLength(2)
      expect(result.value.variables[0].variableName).toBe('aside_frequency')
    }
  })

  it('refuses a format version it cannot read, naming both versions', () => {
    const future = serializePackFile({ ...packFile, formatVersion: DIRECTORY_FORMAT_VERSION + 1 })
    const result = parsePackFile(future)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain(String(DIRECTORY_FORMAT_VERSION + 1))
      expect(result.error).toContain(String(DIRECTORY_FORMAT_VERSION))
    }
  })

  it('refuses malformed YAML', () => {
    const result = parsePackFile('name: [unclosed')
    expect(result.ok).toBe(false)
  })

  it('refuses a file missing required fields', () => {
    const result = parsePackFile('name: Only a name\n')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('formatVersion')
  })
})

describe('template text', () => {
  it('writes line feeds ending in exactly one newline', () => {
    expect(serializeTemplate('a\r\nb')).toBe('a\nb\n')
    expect(serializeTemplate('a\nb\n\n\n')).toBe('a\nb\n')
  })

  it('leaves the stored hash untouched across a round trip through CRLF', () => {
    const stored = 'You are a narrator.\n\n{{ protagonistName }} acts.'
    const written = serializeTemplate(stored)
    const throughWindowsEditor = written.replace(/\n/g, '\r\n')

    expect(parseTemplateFile(throughWindowsEditor)).toBe(stored)
    return Promise.all([
      hashContent(stored),
      hashContent(parseTemplateFile(throughWindowsEditor)),
    ]).then(([before, after]) => expect(after).toBe(before))
  })

  it('is stable across export, import and export again', () => {
    const stored = 'line one\nline two'
    const once = serializeTemplate(stored)
    expect(serializeTemplate(parseTemplateFile(once))).toBe(once)
  })
})
