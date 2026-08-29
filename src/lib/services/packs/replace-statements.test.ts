import { describe, it, expect } from 'vitest'
import {
  packTemplateStatement,
  packVariableStatement,
  packReplacementStatements,
} from './replace-statements'
import type { PackExport } from './validation'

function pack(overrides: Partial<PackExport> = {}): PackExport {
  return {
    version: 1,
    name: 'Grimdark Narrator',
    templates: [{ templateId: 'adventure', content: 'tell a story' }],
    variables: [],
    ...overrides,
  }
}

describe('packTemplateStatement', () => {
  it('records the file as the row baseline', () => {
    const { sql, params } = packTemplateStatement({
      id: 'row-1',
      packId: 'pack-1',
      templateId: 'adventure',
      content: 'tell a story',
      contentHash: 'abc123',
      now: 1000,
    })

    expect(sql).toContain('INSERT INTO pack_templates')
    expect(params).toEqual([
      'row-1',
      'pack-1',
      'adventure',
      'tell a story',
      'abc123',
      'abc123',
      1000,
      1000,
    ])
    // content_hash and baseline_hash are positions 4 and 5: equal means "untouched", which is
    // what the pack is until the user edits it.
    expect(params[4]).toBe(params[5])
  })
})

describe('packVariableStatement', () => {
  it('writes NULL, never undefined, for absent optional fields', () => {
    const { params } = packVariableStatement({
      id: 'var-1',
      packId: 'pack-1',
      variable: {
        variableName: 'tone',
        displayName: 'Tone',
        variableType: 'text',
        isRequired: false,
      },
      sortOrder: 3,
      now: 1000,
    })

    expect(params).not.toContain(undefined)
    expect(params).toEqual([
      'var-1',
      'pack-1',
      'tone',
      'Tone',
      null,
      'text',
      0,
      3,
      null,
      null,
      1000,
    ])
  })

  it('serializes enum options and keeps the file sort order', () => {
    const { params } = packVariableStatement({
      id: 'var-1',
      packId: 'pack-1',
      variable: {
        variableName: 'tone',
        displayName: 'Tone',
        description: 'How it reads',
        variableType: 'enum',
        isRequired: true,
        sortOrder: 7,
        defaultValue: 'grim',
        enumOptions: [{ label: 'Grim', value: 'grim' }],
      },
      sortOrder: 3,
      now: 1000,
    })

    expect(params[4]).toBe('How it reads')
    expect(params[6]).toBe(1)
    expect(params[7]).toBe(7)
    expect(params[9]).toBe(JSON.stringify([{ label: 'Grim', value: 'grim' }]))
  })
})

describe('packReplacementStatements', () => {
  const base = {
    packId: 'pack-1',
    hashes: new Map([['adventure', 'abc123']]),
    ids: { templates: ['row-1'], variables: [] },
    now: 1000,
  }

  it('updates the pack row and clears its children without deleting the pack', () => {
    const statements = packReplacementStatements({ ...base, packData: pack() })
    const sql = statements.map((s) => s.sql).join('\n')

    expect(sql).toContain('UPDATE preset_packs')
    expect(sql).toContain('DELETE FROM pack_templates')
    expect(sql).toContain('DELETE FROM pack_variables')
    expect(sql).not.toContain('DELETE FROM preset_packs')
    // Deleting the pack row would cascade these away and strand every entity value keyed to
    // them; the file carries no runtime variables to put back.
    expect(sql).not.toContain('pack_runtime_variables')
  })

  it('leaves the pack name alone', () => {
    const statements = packReplacementStatements({ ...base, packData: pack() })
    const update = statements[0]

    expect(update.sql).not.toContain('name')
    expect(update.params).not.toContain('Grimdark Narrator')
  })

  it('passes no undefined parameter when description and author are absent', () => {
    const statements = packReplacementStatements({
      ...base,
      packData: pack({
        variables: [
          { variableName: 'tone', displayName: 'Tone', variableType: 'text', isRequired: false },
        ],
      }),
      ids: { templates: ['row-1'], variables: ['var-1'] },
    })

    for (const statement of statements) {
      expect(statement.params).not.toContain(undefined)
    }
  })

  it('clears the children before inserting the replacements', () => {
    const statements = packReplacementStatements({ ...base, packData: pack() })
    const lastDelete = statements.findLastIndex((s) => s.sql.startsWith('DELETE'))
    const firstInsert = statements.findIndex((s) => s.sql.startsWith('INSERT'))

    expect(firstInsert).toBeGreaterThan(lastDelete)
  })

  it('refuses a template it has no hash for', () => {
    expect(() =>
      packReplacementStatements({
        ...base,
        packData: pack({ templates: [{ templateId: 'unhashed', content: 'x' }] }),
      }),
    ).toThrow(/no hash for template unhashed/)
  })

  it('refuses an id list that does not cover every row', () => {
    expect(() =>
      packReplacementStatements({
        ...base,
        packData: pack(),
        ids: { templates: [], variables: [] },
      }),
    ).toThrow(/one id required per template/)
  })
})
