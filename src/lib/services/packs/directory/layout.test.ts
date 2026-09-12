import { describe, it, expect } from 'vitest'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates'
import {
  ABOUT_FILE,
  GITATTRIBUTES_FILE,
  PACK_FILE,
  REFERENCE_DIR,
  UNGROUPED_DIR,
  USER_HALF_SUFFIX,
  classifyPath,
  collectTemplateFiles,
  groupFolderFor,
  isWritableTemplateId,
  templateIdFromPath,
  templatePath,
} from './layout'

/** Every row a full pack holds: each template's system half, and its user half where one ships. */
function storedRowIds(): string[] {
  const ids: string[] = []
  for (const template of PROMPT_TEMPLATES) {
    ids.push(template.id)
    if (template.userContent !== undefined) ids.push(`${template.id}${USER_HALF_SUFFIX}`)
  }
  return ids
}

describe('templatePath', () => {
  it('round-trips every shipped row id, both halves', () => {
    for (const id of storedRowIds()) {
      expect(templateIdFromPath(templatePath(id))).toBe(id)
    }
  })

  it('files a user half beside its system half', () => {
    const withUserHalf = PROMPT_TEMPLATES.find((t) => t.userContent !== undefined)!
    expect(groupFolderFor(`${withUserHalf.id}${USER_HALF_SUFFIX}`)).toBe(
      groupFolderFor(withUserHalf.id),
    )
  })

  it('files an id the app no longer ships under the reserved folder', () => {
    expect(templatePath('retired-prompt')).toBe(`${UNGROUPED_DIR}/retired-prompt.md`)
    expect(templateIdFromPath(templatePath('retired-prompt'))).toBe('retired-prompt')
  })
})

describe('templateIdFromPath', () => {
  it('ignores the containing folder', () => {
    expect(templateIdFromPath('Analysis/classifier.md')).toBe('classifier')
    expect(templateIdFromPath('Memory/classifier.md')).toBe('classifier')
    expect(templateIdFromPath('somewhere/nested/deep/classifier.md')).toBe('classifier')
  })

  it('accepts backslash separators', () => {
    expect(templateIdFromPath('Analysis\\classifier.md')).toBe('classifier')
  })
})

describe('classifyPath', () => {
  it('reads pack.yaml and templates below the root', () => {
    expect(classifyPath(PACK_FILE)).toBe('pack-file')
    expect(classifyPath('Story Generation/adventure.md')).toBe('template')
  })

  it('ignores the user’s own root files and the generated ones', () => {
    expect(classifyPath('README.md')).toBe('ignored')
    expect(classifyPath(ABOUT_FILE)).toBe('ignored')
    expect(classifyPath(GITATTRIBUTES_FILE)).toBe('ignored')
  })

  it('ignores underscore-prefixed folders at any depth', () => {
    expect(classifyPath(`${REFERENCE_DIR}/system-variables.md`)).toBe('ignored')
    expect(classifyPath(`Analysis/${REFERENCE_DIR}/notes.md`)).toBe('ignored')
  })

  // The rule is about folders. A template whose own id starts with `_` would otherwise export
  // and then never come back.
  it('reads a template whose own name starts with an underscore', () => {
    expect(classifyPath('Other/_scratch.md')).toBe('template')
    expect(templateIdFromPath('Other/_scratch.md')).toBe('_scratch')
  })

  it('ignores files that are not markdown', () => {
    expect(classifyPath('Analysis/classifier.txt')).toBe('ignored')
    expect(classifyPath('Analysis/notes.yaml')).toBe('ignored')
  })
})

describe('collectTemplateFiles', () => {
  it('resolves a tree to stored ids', () => {
    const collected = collectTemplateFiles([
      PACK_FILE,
      ABOUT_FILE,
      'README.md',
      `${REFERENCE_DIR}/system-variables.md`,
      'Analysis/classifier.md',
      'Analysis/classifier-user.md',
    ])

    expect(collected.duplicates).toEqual([])
    expect([...collected.templates.keys()].sort()).toEqual(['classifier', 'classifier-user'])
  })

  // buildTree refuses these on export, so accepting them here would import a pack whose
  // directory export can never succeed, with no way to rename a stored id.
  it('refuses two files whose stems differ only in capitalisation', () => {
    const collected = collectTemplateFiles(['Analysis/adventure.md', 'Memory/Adventure.md'])

    expect(collected.templates.size).toBe(0)
    expect(collected.duplicates).toHaveLength(1)
    expect(collected.duplicates[0].paths).toEqual(['Analysis/adventure.md', 'Memory/Adventure.md'])
  })

  it('reports every conflicting path and yields no templates', () => {
    const collected = collectTemplateFiles([
      'Analysis/classifier.md',
      'Memory/classifier.md',
      'Story Generation/adventure.md',
    ])

    expect(collected.templates.size).toBe(0)
    expect(collected.duplicates).toEqual([
      { templateId: 'classifier', paths: ['Analysis/classifier.md', 'Memory/classifier.md'] },
    ])
  })
})

describe('isWritableTemplateId', () => {
  it('accepts every shipped row id', () => {
    for (const id of storedRowIds()) expect(isWritableTemplateId(id)).toBe(true)
  })

  it('rejects an id that would gain a folder and come back as its last segment', () => {
    expect(isWritableTemplateId('custom/example')).toBe(false)
    expect(isWritableTemplateId('custom\\example')).toBe(false)
  })

  it('accepts an underscore-prefixed id', () => {
    expect(isWritableTemplateId('_scratch')).toBe(true)
  })

  // These reach buildTree through a hand-written .prompt.json, and plugin-fs fails on them.
  it.each(['a:b', 'why?', 'a<b', 'a>b', 'a|b', 'a"b', 'a*b'])(
    'rejects %s, which Windows forbids in a filename',
    (id) => {
      expect(isWritableTemplateId(id)).toBe(false)
    },
  )

  it.each(['con', 'PRN', 'aux', 'nul', 'com1', 'LPT9'])(
    'rejects the reserved device name %s',
    (id) => {
      expect(isWritableTemplateId(id)).toBe(false)
    },
  )

  it('rejects a trailing dot or space, which Windows strips', () => {
    expect(isWritableTemplateId('trailing.')).toBe(false)
    expect(isWritableTemplateId('trailing ')).toBe(false)
  })

  it('rejects an empty id', () => {
    expect(isWritableTemplateId('')).toBe(false)
  })

  it('still accepts ordinary hyphenated ids', () => {
    expect(isWritableTemplateId('chapter-analysis')).toBe(true)
    expect(isWritableTemplateId('image-style-soft-anime')).toBe(true)
  })
})

describe('shipped template ids', () => {
  // A shipped id ending in `-user` would be indistinguishable from another prompt's user half,
  // both in storage and in the tree.
  it('never end in the user-half suffix', () => {
    const colliding = PROMPT_TEMPLATES.filter((t) => t.id.endsWith(USER_HALF_SUFFIX))
    expect(colliding.map((t) => t.id)).toEqual([])
  })
})
