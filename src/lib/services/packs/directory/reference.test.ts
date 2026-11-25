import { describe, it, expect } from 'vitest'
import { SYSTEM_VARIABLES, RUNTIME_VARIABLES } from '#lib/services/templates/variables.ts'
import { readFileSync } from 'node:fs'
import {
  ABOUT_FILE,
  GITATTRIBUTES_FILE,
  PACK_FILE,
  README_FILE,
  REFERENCE_DIR,
  UNGROUPED_DIR,
  USER_HALF_SUFFIX,
  USER_README_STEM,
  VERSION_FILE,
  groupFolderFor,
} from './layout'
import { gitattributesDoc, readmeDoc, variablesDoc, versionDoc } from './reference'

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

describe('versionDoc', () => {
  it('states the version and nothing that varies with anything else', () => {
    expect(versionDoc('1.2.3')).toBe('# Aventuras version\n\n1.2.3\n')
  })
})

describe('generated root files', () => {
  it('pins line endings and nothing else', () => {
    expect(gitattributesDoc()).toBe('* text eol=lf\n')
  })

  it('writes the repository’s guide as the README, with line feeds', () => {
    const guide = readFileSync(
      new URL('../../../../../guides/prompt-packs-as-folders.md', import.meta.url),
      'utf-8',
    )
    expect(readmeDoc()).toBe(guide.replace(/\r\n/g, '\n'))
    expect(readmeDoc()).not.toContain('\r')
  })

  // The guide spells these names out, so renaming one without the guide fails here.
  it('names every file and folder the layout reserves', () => {
    const doc = readmeDoc()
    for (const name of [
      `\`${PACK_FILE}\``,
      `\`${README_FILE}\``,
      `\`${GITATTRIBUTES_FILE}\``,
      `\`${REFERENCE_DIR}/\``,
      `\`${REFERENCE_DIR}/${VERSION_FILE}\``,
      `\`${UNGROUPED_DIR}/\``,
      `\`${USER_README_STEM}.md\``,
      `\`${ABOUT_FILE}\``,
      `\`${USER_HALF_SUFFIX}.md\``,
      `\`${groupFolderFor('adventure')}/\``,
    ]) {
      expect(doc).toContain(name)
    }
  })
})
