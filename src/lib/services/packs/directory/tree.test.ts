import { describe, it, expect } from 'vitest'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import { ABOUT_FILE, GITATTRIBUTES_FILE, PACK_FILE, REFERENCE_DIR, UNGROUPED_DIR } from './layout'
import {
  buildShippedBaselineTree,
  buildTree,
  planPrune,
  shippedTemplateRows,
  type TreeInput,
} from './tree'

const input: TreeInput = {
  source: 'pack',
  appVersion: '0.7.9',
  name: 'My Pack',
  templates: [
    { templateId: 'adventure', content: 'Narrate for {{ protagonistName }}.' },
    { templateId: 'adventure-user', content: 'The player did: {{ userAction }}' },
    { templateId: 'retired-prompt', content: 'An id the app no longer ships.' },
  ],
  variables: [],
  status: { kind: 'custom-pack', rows: [] },
}

describe('buildTree', () => {
  it('is byte-identical across two builds of the same pack', () => {
    const first = buildTree(input)
    const second = buildTree(input)

    expect([...second.keys()].sort()).toEqual([...first.keys()].sort())
    for (const [path, content] of first) expect(second.get(path)).toBe(content)
  })

  it('writes one file per stored row plus the reserved files', () => {
    const tree = buildTree(input)

    expect(tree.has('Story Generation/adventure.md')).toBe(true)
    expect(tree.has('Story Generation/adventure-user.md')).toBe(true)
    expect(tree.has(`${UNGROUPED_DIR}/retired-prompt.md`)).toBe(true)

    expect(tree.has(PACK_FILE)).toBe(true)
    expect(tree.has(ABOUT_FILE)).toBe(true)
    expect(tree.has(GITATTRIBUTES_FILE)).toBe(true)
    expect(tree.has(`${REFERENCE_DIR}/system-variables.md`)).toBe(true)
    expect(tree.has(`${REFERENCE_DIR}/runtime-variables.md`)).toBe(true)
    expect(tree.has(`${REFERENCE_DIR}/template-variables.md`)).toBe(true)
    expect(tree.has(`${REFERENCE_DIR}/template-status.md`)).toBe(true)
  })

  it('writes a template file as its text and nothing else', () => {
    const tree = buildTree(input)
    expect(tree.get('Story Generation/adventure.md')).toBe('Narrate for {{ protagonistName }}.\n')
  })
})

describe('buildShippedBaselineTree', () => {
  it('covers every shipped row', () => {
    const tree = buildShippedBaselineTree('0.7.9')
    const templateFiles = [...tree.keys()].filter(
      (p) => !p.startsWith(REFERENCE_DIR) && p.endsWith('.md') && p.includes('/'),
    )

    expect(templateFiles).toHaveLength(shippedTemplateRows().length)
    expect(shippedTemplateRows().length).toBeGreaterThan(PROMPT_TEMPLATES.length)
  })

  it('declares itself a shipped baseline with no custom variables', () => {
    const packFile = buildShippedBaselineTree('0.7.9').get(PACK_FILE)!
    expect(packFile).toContain('source: shipped-baseline')
    expect(packFile).toContain('variables: []')
  })

  it('reports nothing edited', () => {
    const status = buildShippedBaselineTree('0.7.9').get(`${REFERENCE_DIR}/template-status.md`)!
    expect(status).toContain('No template in this export carries an edit made in the app.')
  })

  it('is unaffected by anything stored in a pack', () => {
    // It reads PROMPT_TEMPLATES, so no pack argument exists to influence it.
    const first = buildShippedBaselineTree('0.7.9')
    const second = buildShippedBaselineTree('0.7.9')
    for (const [path, content] of first) expect(second.get(path)).toBe(content)
  })
})

describe('planPrune', () => {
  const tree = buildTree(input)

  it('removes a template file the export no longer writes', () => {
    const stale = 'Analysis/dropped-prompt.md'
    expect(planPrune([...tree.keys(), stale], tree)).toEqual([stale])
  })

  it('removes stale generated reference material', () => {
    const stale = `${REFERENCE_DIR}/old-index.md`
    expect(planPrune([...tree.keys(), stale], tree)).toEqual([stale])
  })

  it('leaves the user’s own files alone', () => {
    const untouched = ['README.md', 'NOTES.md', '.git/config', '.gitignore', 'notes/todo.txt']
    expect(planPrune([...tree.keys(), ...untouched], tree)).toEqual([])
  })

  it('leaves everything alone when the tree is unchanged', () => {
    expect(planPrune([...tree.keys()], tree)).toEqual([])
  })

  // On Windows and macOS these two spellings are one file: pruning the existing spelling
  // after writing the generated one deletes the template the export just wrote.
  it('does not prune a file it just wrote under different casing', () => {
    const existing = [...tree.keys()].map((p) => p.toLowerCase())
    expect(planPrune(existing, tree)).toEqual([])
  })

  it('still prunes a genuinely stale file whose casing differs from nothing written', () => {
    const stale = 'analysis/dropped-prompt.md'
    expect(planPrune([...tree.keys(), stale], tree)).toEqual([stale])
  })
})

describe('unwritable template ids', () => {
  it('refuses an id holding a path separator rather than changing what it is', () => {
    expect(() =>
      buildTree({ ...input, templates: [{ templateId: 'custom/example', content: 'x' }] }),
    ).toThrow(/custom\/example/)
  })

  it('refuses an id Windows cannot use as a filename', () => {
    expect(() => buildTree({ ...input, templates: [{ templateId: 'a:b', content: 'x' }] })).toThrow(
      /a:b/,
    )
  })

  // One file on Windows and macOS, so one would silently overwrite the other.
  it('refuses two ids that differ only in capitalisation', () => {
    expect(() =>
      buildTree({
        ...input,
        templates: [
          { templateId: 'adventure', content: 'x' },
          { templateId: 'Adventure', content: 'y' },
        ],
      }),
    ).toThrow(/capitalisation/)
  })

  it('accepts an id starting with an underscore, which is a template and not a folder', () => {
    const built = buildTree({ ...input, templates: [{ templateId: '_scratch', content: 'x' }] })
    expect(built.has(`${UNGROUPED_DIR}/_scratch.md`)).toBe(true)
  })
})
