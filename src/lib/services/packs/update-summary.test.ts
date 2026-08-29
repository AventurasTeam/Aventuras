import { describe, it, expect } from 'vitest'
import { packUpdateSummary } from './update-summary'
import type { PackExport } from './validation'

function variable(variableName: string): PackExport['variables'][number] {
  return { variableName, displayName: variableName, variableType: 'text', isRequired: false }
}

function pack(variableNames: string[]): PackExport {
  return {
    version: 1,
    name: 'Grimdark Narrator',
    templates: [],
    variables: variableNames.map(variable),
  }
}

describe('packUpdateSummary', () => {
  it('counts a template the user edited and not one left alone', () => {
    const summary = packUpdateSummary({
      currentTemplates: [
        { contentHash: 'aaa', baselineHash: 'aaa' },
        { contentHash: 'edited', baselineHash: 'aaa' },
        // A row created by the editor keeps no baseline, so it reads as edited.
        { contentHash: 'bbb', baselineHash: '' },
      ],
      currentVariables: [],
      packData: pack([]),
      storyCount: 0,
    })

    expect(summary.editedTemplates).toBe(2)
  })

  it('reports variables added, removed, and unchanged', () => {
    const summary = packUpdateSummary({
      currentTemplates: [],
      currentVariables: [{ variableName: 'tone' }, { variableName: 'era' }],
      packData: pack(['tone', 'pov']),
      storyCount: 0,
    })

    expect(summary.addedVariables).toEqual(['pov'])
    expect(summary.removedVariables).toEqual(['era'])
  })

  it('reports no variable change when the file defines the same set', () => {
    const summary = packUpdateSummary({
      currentTemplates: [],
      currentVariables: [{ variableName: 'tone' }],
      packData: pack(['tone']),
      storyCount: 0,
    })

    expect(summary.addedVariables).toEqual([])
    expect(summary.removedVariables).toEqual([])
  })

  it('passes the story count through', () => {
    const summary = packUpdateSummary({
      currentTemplates: [],
      currentVariables: [],
      packData: pack([]),
      storyCount: 3,
    })

    expect(summary.storyCount).toBe(3)
  })
})
