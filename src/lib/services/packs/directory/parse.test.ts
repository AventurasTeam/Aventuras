import { describe, it, expect } from 'vitest'
import { ABOUT_FILE, GITATTRIBUTES_FILE, PACK_FILE, REFERENCE_DIR } from './layout'
import { DIRECTORY_FORMAT_VERSION, serializePackFile } from './serialize'
import { validateTree } from './parse'

const packYaml = serializePackFile({
  formatVersion: DIRECTORY_FORMAT_VERSION,
  appVersion: '0.7.9',
  source: 'pack',
  name: 'My Pack',
  variables: [
    {
      variableName: 'writing_style',
      displayName: 'Writing Style',
      variableType: 'text',
      isRequired: false,
      sortOrder: 0,
    },
  ],
})

function tree(extra: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      [PACK_FILE]: packYaml,
      'Story Generation/adventure.md': 'Narrate for {{ protagonistName }}.\n',
      'Story Generation/adventure-user.md': 'The player did: {{ userAction }}\n',
      ...extra,
    }),
  )
}

describe('validateTree', () => {
  it('accepts a well-formed tree', () => {
    const result = validateTree(tree())

    expect(result.valid).toBe(true)
    expect(result.source).toBe('pack')
    expect(result.pack!.name).toBe('My Pack')
    expect(result.pack!.templates.map((t) => t.templateId)).toEqual(['adventure', 'adventure-user'])
    expect(result.pack!.variables).toHaveLength(1)
  })

  it('strips the trailing newline a file carries', () => {
    const result = validateTree(tree())
    expect(result.pack!.templates[0].content).toBe('Narrate for {{ protagonistName }}.')
  })

  it('reads only template files, ignoring the rest', () => {
    // The reader drops ignored paths, but a hand-assembled tree may still carry them.
    const result = validateTree(
      tree({
        'README.md': 'my notes',
        [ABOUT_FILE]: 'generated',
        [GITATTRIBUTES_FILE]: '* text eol=lf\n',
        [`${REFERENCE_DIR}/template-status.md`]: 'generated',
      }),
    )

    expect(result.valid).toBe(true)
    expect(result.pack!.templates.map((t) => t.templateId)).toEqual(['adventure', 'adventure-user'])
  })

  it('refuses a duplicate stem, naming both files', () => {
    const result = validateTree(tree({ 'Analysis/adventure.md': 'a second one' }))

    expect(result.valid).toBe(false)
    expect(result.pack).toBeUndefined()
    expect(result.structuralErrors[0]).toContain('Analysis/adventure.md')
    expect(result.structuralErrors[0]).toContain('Story Generation/adventure.md')
  })

  it('refuses a template that is not valid Liquid, naming the file', () => {
    const result = validateTree(tree({ 'Analysis/classifier.md': '{% if unclosed %}' }))

    expect(result.valid).toBe(false)
    expect(result.pack).toBeUndefined()
    expect(result.templateErrors).toHaveLength(1)
    expect(result.templateErrors[0].path).toBe('Analysis/classifier.md')
    expect(result.templateErrors[0].templateId).toBe('classifier')
  })

  it.each([
    ['an unclosed tag', '{% if unclosed %}'],
    ['a mismatched end tag', '{% if a %}x{% endfor %}'],
    ['an unclosed output', '{{ genre '],
    ['a filter the app does not have', '{{ genre | nosuchfilter }}'],
  ])('refuses %s, leaving nothing applied', (_label, content) => {
    const result = validateTree(tree({ 'Analysis/classifier.md': content }))

    expect(result.valid).toBe(false)
    expect(result.pack).toBeUndefined()
    expect(result.templateErrors[0].path).toBe('Analysis/classifier.md')
  })

  // Liquid renders an unknown name as an empty string, so nothing here can catch a typo.
  // ABOUT.md documents this because it is the one failure the import cannot warn about.
  it('accepts a variable name the app does not know', () => {
    const result = validateTree(tree({ 'Analysis/classifier.md': '{{ protagonistNmae }} acts.' }))

    expect(result.valid).toBe(true)
    expect(result.pack!.templates.find((t) => t.templateId === 'classifier')!.content).toBe(
      '{{ protagonistNmae }} acts.',
    )
  })

  it('refuses a folder with no pack.yaml', () => {
    const withoutPackFile = tree()
    withoutPackFile.delete(PACK_FILE)

    const result = validateTree(withoutPackFile)
    expect(result.valid).toBe(false)
    expect(result.structuralErrors[0]).toContain(PACK_FILE)
  })

  it('refuses a format version it cannot read', () => {
    const future = serializePackFile({
      formatVersion: DIRECTORY_FORMAT_VERSION + 1,
      appVersion: '9.9.9',
      source: 'pack',
      name: 'From the future',
      variables: [],
    })

    const result = validateTree(tree({ [PACK_FILE]: future }))
    expect(result.valid).toBe(false)
    expect(result.structuralErrors[0]).toContain('format version')
  })

  it('carries the shipped-baseline marker through', () => {
    const baseline = serializePackFile({
      formatVersion: DIRECTORY_FORMAT_VERSION,
      appVersion: '0.7.9',
      source: 'shipped-baseline',
      name: 'Aventuras 0.7.9 shipped prompts',
      variables: [],
    })

    const result = validateTree(tree({ [PACK_FILE]: baseline }))
    expect(result.valid).toBe(true)
    expect(result.source).toBe('shipped-baseline')
    expect(result.pack!.variables).toEqual([])
  })
})
