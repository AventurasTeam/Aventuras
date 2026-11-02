import { describe, it, expect } from 'vitest'
import { PROMPT_TEMPLATES } from '#lib/services/prompts/templates/index.ts'
import {
  ABOUT_FILE,
  GITATTRIBUTES_FILE,
  PACK_FILE,
  README_FILE,
  REFERENCE_DIR,
  UNGROUPED_DIR,
  VERSION_FILE,
} from './layout'
import {
  buildShippedBaselineTree,
  buildTree,
  emptiedFolderCandidates,
  folderOrigin,
  planFolderChanges,
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

    expect(tree.has('01 Story Generation/adventure.md')).toBe(true)
    expect(tree.has('01 Story Generation/adventure-user.md')).toBe(true)
    expect(tree.has(`${UNGROUPED_DIR}/retired-prompt.md`)).toBe(true)

    expect(tree.has(PACK_FILE)).toBe(true)
    expect(tree.has(README_FILE)).toBe(true)
    expect(tree.has(ABOUT_FILE)).toBe(false)
    expect(tree.has(GITATTRIBUTES_FILE)).toBe(true)
    expect([...tree.keys()].filter((path) => path.startsWith(`${REFERENCE_DIR}/`)).sort()).toEqual([
      `${REFERENCE_DIR}/runtime-variables.md`,
      `${REFERENCE_DIR}/system-variables.md`,
      `${REFERENCE_DIR}/${VERSION_FILE}`,
    ])
  })

  it('writes a template file as its text and nothing else', () => {
    const tree = buildTree(input)
    expect(tree.get('01 Story Generation/adventure.md')).toBe(
      'Narrate for {{ protagonistName }}.\n',
    )
  })

  it('states the application version in the version file alone', () => {
    const tree = buildTree({ ...input, appVersion: '9.8.7' })
    const stating = [...tree].filter(([, content]) => content.includes('9.8.7')).map(([p]) => p)
    expect(stating).toEqual([`${REFERENCE_DIR}/${VERSION_FILE}`])
  })

  it('leaves the reference material unchanged when a template’s variables change', () => {
    const before = buildTree(input)
    const after = buildTree({
      ...input,
      templates: input.templates.with(0, {
        templateId: 'adventure',
        content: 'Narrate for {{ storyTitle }}.',
      }),
    })

    for (const [path, content] of before) {
      if (path.startsWith(`${REFERENCE_DIR}/`)) expect(after.get(path)).toBe(content)
    }
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

  it('writes the same pack.yaml from every application version', () => {
    expect(buildShippedBaselineTree('1.1.0').get(PACK_FILE)).toBe(
      buildShippedBaselineTree('1.0.0').get(PACK_FILE),
    )
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

describe('folderOrigin', () => {
  it('tells this format, an earlier one, and a stranger’s folder apart', () => {
    expect(folderOrigin(buildTree(input).get(PACK_FILE))).toBe('current')
    expect(
      folderOrigin('formatVersion: 1\nappVersion: 0.7.9\nsource: pack\nname: X\nvariables: []\n'),
    ).toBe('earlier')
    expect(folderOrigin(undefined)).toBe('foreign')
    expect(folderOrigin('name: someone else’s tool\n')).toBe('foreign')
  })

  // A newer format may change the rest of the schema, so only its declared version is trusted.
  it('recognises a newer format even when the rest of pack.yaml no longer parses', () => {
    expect(folderOrigin('formatVersion: 99\nsomethingNew: true\n')).toBe('newer')
  })
})

describe('planFolderChanges', () => {
  const tree = buildTree(input)
  const formatOne = [
    PACK_FILE,
    ABOUT_FILE,
    README_FILE,
    GITATTRIBUTES_FILE,
    'Story Generation/adventure.md',
    'Story Generation/adventure-user.md',
    'Other/retired-prompt.md',
    `${REFERENCE_DIR}/system-variables.md`,
    `${REFERENCE_DIR}/runtime-variables.md`,
    `${REFERENCE_DIR}/template-variables.md`,
    `${REFERENCE_DIR}/template-status.md`,
    '_notes/ideas.md',
    'NOTES.md',
  ]

  it('brings a format 1 tree up to date, moving the user’s README aside', () => {
    const { prunePaths, renames } = planFolderChanges(formatOne, tree, 'earlier')

    expect(renames).toEqual([{ from: README_FILE, to: 'README_user.md' }])
    expect(prunePaths).toEqual(
      [
        ABOUT_FILE,
        'Other/retired-prompt.md',
        'Story Generation/adventure-user.md',
        'Story Generation/adventure.md',
        `${REFERENCE_DIR}/template-status.md`,
        `${REFERENCE_DIR}/template-variables.md`,
      ].toSorted(),
    )
  })

  it('tells templates that move to a numbered folder from files that are gone', () => {
    const { movedPaths } = planFolderChanges(formatOne, tree, 'earlier')
    expect(movedPaths).toEqual([
      'Other/retired-prompt.md',
      'Story Generation/adventure-user.md',
      'Story Generation/adventure.md',
    ])
  })

  it('still counts a template the pack no longer has as deleted, not moved', () => {
    const { prunePaths, movedPaths } = planFolderChanges(
      [...tree.keys(), '02 Analysis/dropped-prompt.md'],
      tree,
      'current',
    )
    expect(prunePaths).toEqual(['02 Analysis/dropped-prompt.md'])
    expect(movedPaths).toEqual([])
  })

  it('takes the next free name when README_user.md is taken', () => {
    const taken = [...formatOne, 'readme_user.md', 'README_user_2.md']
    expect(planFolderChanges(taken, tree, 'earlier').renames).toEqual([
      { from: README_FILE, to: 'README_user_3.md' },
    ])
  })

  it('moves a README aside in a folder it does not recognise, and prunes nothing', () => {
    const { prunePaths, renames } = planFolderChanges(
      ['readme.md', 'notes/ideas.md'],
      tree,
      'foreign',
    )
    expect(renames).toEqual([{ from: 'readme.md', to: 'README_user.md' }])
    expect(prunePaths).toEqual([])
  })

  it('moves aside every spelling of README.md a case-sensitive filesystem can hold', () => {
    expect(planFolderChanges(['readme.md', README_FILE], tree, 'foreign').renames).toEqual([
      { from: README_FILE, to: 'README_user.md' },
      { from: 'readme.md', to: 'README_user_2.md' },
    ])
  })

  it('overwrites its own README and keeps a user’s ABOUT.md in a current tree', () => {
    const { prunePaths, renames } = planFolderChanges([...tree.keys(), ABOUT_FILE], tree, 'current')
    expect(renames).toEqual([])
    expect(prunePaths).toEqual([])
  })
})

describe('emptiedFolderCandidates', () => {
  it('lists each pruned file’s folders, deepest first, and no root', () => {
    expect(
      emptiedFolderCandidates([
        'Analysis/classifier.md',
        'Analysis/old/deep.md',
        `${REFERENCE_DIR}/template-status.md`,
        ABOUT_FILE,
      ]),
    ).toEqual(['Analysis/old', REFERENCE_DIR, 'Analysis'])
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
