/**
 * Export and import agreeing with each other.
 *
 * The unit tests either side pin half of it each. What they cannot show is that what the
 * exporter wrote is exactly what the importer reads back — including through an editor that
 * rewrites every line ending, which is the ordinary case on Windows.
 */

import { describe, it, expect } from 'vitest'
import { hashContent } from '../hash'
import { isUntouched } from '../staleness'
import { classifyPath } from './layout'
import { validateTree } from './parse'
import { buildTree, type Tree } from './tree'

const stored = [
  { templateId: 'adventure', content: 'Narrate for {{ protagonistName }}.\n\nStay in scene.' },
  { templateId: 'adventure-user', content: 'The player did: {{ userAction }}' },
  { templateId: 'classifier', content: 'Classify.\n\n{% if mode %}Adventure.{% endif %}' },
]

/** What `readTree` hands the importer: the tree, minus everything the import ignores. */
function asReadContents(tree: Tree, rewriteLineEndings = false): Map<string, string> {
  const contents = new Map<string, string>()
  for (const [path, content] of tree) {
    if (classifyPath(path) === 'ignored') continue
    contents.set(path, rewriteLineEndings ? content.replace(/\n/g, '\r\n') : content)
  }
  return contents
}

async function exportThenImport(rewriteLineEndings: boolean) {
  const rows = await Promise.all(
    stored.map(async (row) => ({ ...row, contentHash: await hashContent(row.content) })),
  )

  const tree = buildTree({
    source: 'pack',
    appVersion: '0.7.9',
    name: 'My Pack',
    templates: stored,
    variables: [],
    status: { kind: 'custom-pack', rows: [] },
  })

  const result = validateTree(asReadContents(tree, rewriteLineEndings))
  expect(result.valid).toBe(true)

  return { rows, imported: result.pack!.templates }
}

describe.each([
  ['written as exported', false],
  ['rewritten with CRLF endings', true],
])('a tree %s', (_label, rewriteLineEndings) => {
  it('brings every stored row back', async () => {
    const { rows, imported } = await exportThenImport(rewriteLineEndings)
    expect(imported.map((t) => t.templateId).sort()).toEqual(rows.map((r) => r.templateId).sort())
  })

  it('leaves every content hash unchanged', async () => {
    const { rows, imported } = await exportThenImport(rewriteLineEndings)

    for (const row of rows) {
      const back = imported.find((t) => t.templateId === row.templateId)!
      expect(await hashContent(back.content)).toBe(row.contentHash)
    }
  })

  it('reports no template as edited once written as the pack’s baseline', async () => {
    const { imported } = await exportThenImport(rewriteLineEndings)

    // An import writes each row as its own baseline, which is what `isBaseline: true` means
    // at the database boundary.
    for (const template of imported) {
      const hash = await hashContent(template.content)
      expect(isUntouched({ contentHash: hash, baselineHash: hash })).toBe(true)
    }
  })

  it('renders the same prompt text as before the round trip', async () => {
    const { imported } = await exportThenImport(rewriteLineEndings)

    for (const row of stored) {
      const back = imported.find((t) => t.templateId === row.templateId)!
      expect(back.content.replace(/\r\n/g, '\n')).toBe(row.content)
    }
  })
})
