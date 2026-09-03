import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import { describe, expect, it } from 'vitest'

// AlertDialogContent scrolls its body and pins the actions row, but it can only pin a
// footer it can see among its own children. A footer returned from a body component
// renders inside the scroll region instead and silently scrolls away with the content
// — the exact failure the pin exists to prevent, and nothing types or throws.
const CONTENT_OPEN = /<AlertDialogContent\b/g
const CONTENT_CLOSE = '</AlertDialogContent>'
const FOOTER_OPEN = /<AlertDialogFooter\b/g

function contentSpans(src: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = []
  for (const open of src.matchAll(CONTENT_OPEN)) {
    const end = src.indexOf(CONTENT_CLOSE, open.index)
    if (end !== -1) spans.push({ start: open.index, end })
  }
  return spans
}

export function findFootersOutsideContent(files: { path: string; src: string }[]): string[] {
  const offenders: string[] = []
  for (const { path, src } of files) {
    const spans = contentSpans(src)
    let index = 0
    for (const footer of src.matchAll(FOOTER_OPEN)) {
      index += 1
      const inside = spans.some((s) => footer.index > s.start && footer.index < s.end)
      if (!inside) offenders.push(`${path}: footer #${index}`)
    }
  }
  return offenders
}

const INLINE = `
  <AlertDialogContent>
    <AlertDialogHeader />
    <AlertDialogFooter><AlertDialogCancel /></AlertDialogFooter>
  </AlertDialogContent>
`
// The shape the embedder swap dialog shipped with: a stage pane returning header,
// body and footer together, with only the pane as the content's child.
const IN_A_PANE = `
  <AlertDialogContent>
    <Pane />
  </AlertDialogContent>
  function Pane() {
    return (
      <>
        <AlertDialogHeader />
        <AlertDialogFooter><AlertDialogCancel /></AlertDialogFooter>
      </>
    )
  }
`

describe('every AlertDialogFooter renders where the primitive can pin it', () => {
  it('tells a nested footer from a direct one (detector is not vacuous)', () => {
    expect(
      findFootersOutsideContent([
        { path: 'components/a.tsx', src: INLINE },
        { path: 'components/b.tsx', src: IN_A_PANE },
        { path: 'components/c.tsx', src: INLINE + IN_A_PANE },
      ]),
    ).toEqual(['components/b.tsx: footer #1', 'components/c.tsx: footer #2'])
  })

  it('no shipped footer sits outside its content', async () => {
    const paths = await fg(['app/**/*.tsx', 'components/**/*.tsx'], {
      ignore: ['**/node_modules/**'],
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    expect(
      findFootersOutsideContent(files),
      'render AlertDialogFooter as a direct child of AlertDialogContent — a footer inside a body component scrolls with the body instead of staying pinned',
    ).toEqual([])
  })
})
