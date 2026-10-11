import { describe, expect, it } from 'vitest'

import { renderWith } from './engine'
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
      templates: { t: { group: 'generationContext', system: '', user: `{% include 'fmt' %}` } },
      macros: { fmt: { group: 'staticContent', source: 'FORMAT' } },
    }
    expect(validatePackIncludes(pack)).toEqual([])
  })

  it('rejects a generationContext template including a wizard-tagged macro', () => {
    const pack: Pack = {
      templates: { t: { group: 'generationContext', system: '', user: `{% include 'wiz' %}` } },
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
      templates: { t: { group: 'wizard', system: '', user: `{% include 'ghost' %}` } },
      macros: {},
    }
    expect(validatePackIncludes(pack)).toEqual([
      { templateId: 't', macroId: 'ghost', reason: 'missing-macro', templateGroup: 'wizard' },
    ])
  })

  // architecture.md → System and user halves.
  it('rejects a missing macro included only from the system half', () => {
    const pack: Pack = {
      templates: { t: { group: 'wizard', system: `{% include 'ghost' %}`, user: 'Go.' } },
      macros: {},
    }
    expect(validatePackIncludes(pack)).toEqual([
      { templateId: 't', macroId: 'ghost', reason: 'missing-macro', templateGroup: 'wizard' },
    ])
  })

  it('rejects a group-mismatched macro included only from the system half', () => {
    const pack: Pack = {
      templates: {
        t: { group: 'generationContext', system: `{% include 'wiz' %}`, user: 'Go.' },
      },
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

  it('reports a macro both halves include once', () => {
    const pack: Pack = {
      templates: {
        t: {
          group: 'generationContext',
          system: `{% include 'wiz' %}`,
          user: `{% include 'wiz' %} {% include 'ghost' %}`,
        },
      },
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
      {
        templateId: 't',
        macroId: 'ghost',
        reason: 'missing-macro',
        templateGroup: 'generationContext',
      },
    ])
  })
})

describe('loadPack', () => {
  it('throws a typed PackLoadError when includes are incompatible', () => {
    const pack: Pack = {
      templates: { t: { group: 'generationContext', system: '', user: `{% include 'wiz' %}` } },
      macros: { wiz: { group: 'wizard', source: 'WIZ' } },
    }
    expect(() => loadPack(pack)).toThrow(PackLoadError)
  })

  it('returns a loaded pack with a render-ready engine for a valid pack', () => {
    const pack: Pack = {
      templates: {
        t: { group: 'generationContext', system: '', user: `ok {% include 'fmt' %}` },
      },
      macros: { fmt: { group: 'staticContent', source: 'FORMAT' } },
    }
    const loaded = loadPack(pack)
    expect(renderWith(loaded.engine, 't', {})).toEqual({ system: '', user: 'ok FORMAT' })
  })
})
