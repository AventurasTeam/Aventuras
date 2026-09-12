import { describe, it, expect } from 'vitest'
import { SYSTEM_VARIABLES, RUNTIME_VARIABLES } from '$lib/services/templates/variables'
import {
  aboutDoc,
  gitattributesDoc,
  templateStatusDoc,
  templateVariablesDoc,
  variablesDoc,
} from './reference'

describe('variablesDoc', () => {
  it('lists every registered system variable', () => {
    const doc = variablesDoc('system')
    for (const variable of SYSTEM_VARIABLES) {
      expect(doc).toContain(`\`${variable.name}\``)
      expect(doc).toContain(variable.description)
    }
  })

  it('lists every registered runtime variable', () => {
    const doc = variablesDoc('runtime')
    for (const variable of RUNTIME_VARIABLES) {
      expect(doc).toContain(`\`${variable.name}\``)
    }
  })

  it('spells out an enum variable’s options', () => {
    expect(variablesDoc('system')).toContain('enum (adventure, creative-writing)')
  })

  it('is deterministic', () => {
    expect(variablesDoc('runtime')).toBe(variablesDoc('runtime'))
  })
})

describe('templateVariablesDoc', () => {
  const templates = new Map([
    ['adventure', 'You are narrating for {{ protagonistName }} in {{ genre }}.'],
    ['classifier', 'Classify what {{ protagonistName }} did.'],
    ['static-one', 'No variables here.'],
  ])

  it('lists the variables a template references', () => {
    const doc = templateVariablesDoc(templates)
    const byTemplate = doc.slice(doc.indexOf('## By template'), doc.indexOf('## By variable'))
    expect(byTemplate).toContain('`adventure` | `genre`, `protagonistName`')
    expect(byTemplate).toContain('`static-one` | —')
  })

  it('lists the templates that reference a variable', () => {
    const doc = templateVariablesDoc(templates)
    const byVariable = doc.slice(doc.indexOf('## By variable'))
    expect(byVariable).toContain('`protagonistName` | yes | `adventure`, `classifier`')
    expect(byVariable).toContain('`genre` | yes | `adventure`')
  })

  it('is deterministic whatever order the templates arrive in', () => {
    const reversed = new Map([...templates.entries()].reverse())
    expect(templateVariablesDoc(reversed)).toBe(templateVariablesDoc(templates))
  })
})

describe('templateStatusDoc', () => {
  const shippedHashes = new Map([
    ['current-one', 'hash-a'],
    ['customised-one', 'hash-b'],
    ['behind-one', 'hash-new'],
  ])

  const rows = [
    { templateId: 'current-one', contentHash: 'hash-a', baselineHash: 'hash-a' },
    { templateId: 'customised-one', contentHash: 'edited', baselineHash: 'hash-b' },
    { templateId: 'behind-one', contentHash: 'edited', baselineHash: 'hash-old' },
    { templateId: 'retired-one', contentHash: 'edited', baselineHash: 'hash-c' },
  ]

  it('separates behind from customised for the built-in pack, and names retired ids', () => {
    const doc = templateStatusDoc({ kind: 'default-pack', rows, shippedHashes })

    const behind = doc.slice(doc.indexOf('## Edited, and newer'), doc.indexOf('## Edited\n'))
    expect(behind).toContain('`behind-one`')
    expect(behind).not.toContain('`customised-one`')

    expect(doc).toContain('## No longer shipped')
    expect(doc).toContain('`retired-one`')
    expect(doc).not.toContain('`current-one`')
  })

  it('reports a custom pack on edited-or-not alone', () => {
    const doc = templateStatusDoc({ kind: 'custom-pack', rows })

    expect(doc).not.toContain('## Edited, and newer')
    expect(doc).not.toContain('No longer shipped')
    expect(doc).toContain('`customised-one`')
    expect(doc).toContain('`behind-one`')
    expect(doc).toContain('`retired-one`')
    expect(doc).not.toContain('`current-one`')
  })

  it('reports nothing edited for a shipped baseline', () => {
    const doc = templateStatusDoc({ kind: 'shipped-baseline' })
    expect(doc).toContain('No template in this export carries an edit made in the app.')
    expect(doc).toContain('merge base you can trust')
  })

  it('reports nothing edited for an untouched pack', () => {
    const untouched = [{ templateId: 'a', contentHash: 'h', baselineHash: 'h' }]
    expect(templateStatusDoc({ kind: 'custom-pack', rows: untouched })).toContain(
      'No template in this export carries an edit made in the app.',
    )
  })
})

describe('generated root files', () => {
  it('pins line endings and nothing else', () => {
    expect(gitattributesDoc()).toBe('* text eol=lf\n')
  })

  it('explains the identity rule, what import ignores, and that replacement deletes', () => {
    const doc = aboutDoc()
    expect(doc).toContain("A file's name is its identity.")
    expect(doc).toContain('README.md')
    expect(doc).toContain('_reference/')
    expect(doc).toContain('Import replaces')
    expect(doc).toContain('Runtime variables are not part of this format.')
  })

  it('warns that a file kept beside the prompts is treated as a prompt', () => {
    const doc = aboutDoc()
    expect(doc).toContain('Do not keep your own notes inside a group folder')
    expect(doc).toContain('removed on the next export')
  })

  it('explains that the files are Liquid and what happens when one is broken', () => {
    const doc = aboutDoc()
    expect(doc).toContain('Liquid templates, not Markdown')
    expect(doc).toContain('{{ variableName }}')
    expect(doc).toContain('The whole import is refused')
    expect(doc).toContain('renders an unknown name as an empty string')
  })
})
