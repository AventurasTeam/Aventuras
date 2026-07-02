import { describe, expect, it } from 'vitest'

import { loadPack, PackLoadError } from './load-pack'
import type { Pack } from './types'
import { extractIncludes, validatePackIncludes } from './validate-includes'

describe('extractIncludes', () => {
  it('finds include and render ids in single or double quotes', () => {
    const src = `a {% include 'x' %} b {%- render "y" -%} c {% include 'x' %}`
    expect(extractIncludes(src).sort()).toEqual(['x', 'y'])
  })
})

describe('validatePackIncludes', () => {
  it('accepts a staticContent include from any group', () => {
    const pack: Pack = {
      templates: { t: { group: 'generationContext', source: `{% include 'fmt' %}` } },
      macros: { fmt: { group: 'staticContent', source: 'FORMAT' } },
    }
    expect(validatePackIncludes(pack)).toEqual([])
  })

  it('rejects a generationContext template including a wizard-tagged macro', () => {
    const pack: Pack = {
      templates: { t: { group: 'generationContext', source: `{% include 'wiz' %}` } },
      macros: { wiz: { group: 'wizard', source: 'WIZ' } },
    }
    expect(validatePackIncludes(pack)).toEqual([
      {
        templateId: 't',
        macroId: 'wiz',
        reason: 'group-mismatch',
        templateGroup: 'generationContext',
        macroGroup: 'wizard',
      },
    ])
  })

  it('rejects a missing macro', () => {
    const pack: Pack = {
      templates: { t: { group: 'wizard', source: `{% include 'ghost' %}` } },
      macros: {},
    }
    expect(validatePackIncludes(pack)).toEqual([
      { templateId: 't', macroId: 'ghost', reason: 'missing-macro', templateGroup: 'wizard' },
    ])
  })
})

describe('loadPack', () => {
  it('throws a typed PackLoadError when includes are incompatible', () => {
    const pack: Pack = {
      templates: { t: { group: 'generationContext', source: `{% include 'wiz' %}` } },
      macros: { wiz: { group: 'wizard', source: 'WIZ' } },
    }
    expect(() => loadPack(pack)).toThrow(PackLoadError)
  })

  it('returns a loaded pack with a render-ready engine for a valid pack', () => {
    const pack: Pack = {
      templates: { t: { group: 'generationContext', source: `ok {% include 'fmt' %}` } },
      macros: { fmt: { group: 'staticContent', source: 'FORMAT' } },
    }
    const loaded = loadPack(pack)
    expect(loaded.engine.renderFileSync('t', {})).toBe('ok FORMAT')
  })
})
