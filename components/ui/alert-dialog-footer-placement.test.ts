import { readFileSync } from 'node:fs'

import fg from 'fast-glob'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// AlertDialogContent scrolls its body and pins the actions row, but it pins by identity
// over its own direct children (`child.type === AlertDialogFooter`). A footer one level
// deeper — returned from a body component, or wrapped in a View or a fragment — is
// invisible to that partition, renders inside the scroll region and silently scrolls
// away with the content: the exact failure the pin exists to prevent, and nothing types
// or throws. Nesting depth is the whole question, so this reads JSX ancestry rather than
// source positions.
const CONTENT_TAG = 'AlertDialogContent'
const FOOTER_TAG = 'AlertDialogFooter'

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment

function isJsxNode(node: ts.Node): node is JsxNode {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)
}

function tagNameOf(node: JsxNode): string | null {
  if (ts.isJsxFragment(node)) return null
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  return tag.getText(node.getSourceFile())
}

/**
 * Expression containers are transparent here on purpose: `{cond ? <Footer/> : null}` and
 * `{rows.map(...)}` still reach the partition as direct children, because React resolves
 * the expression and `Children.toArray` flattens arrays. Only a JSX node in between — an
 * element or a fragment — actually buries the footer.
 */
function nearestJsxAncestor(node: ts.Node): JsxNode | null {
  for (let parent = node.parent; parent != null; parent = parent.parent) {
    if (isJsxNode(parent)) return parent
  }
  return null
}

export function findFootersOutsideContent(files: { path: string; src: string }[]): string[] {
  const offenders: string[] = []
  for (const { path, src } of files) {
    if (!src.includes(FOOTER_TAG)) continue
    const source = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (isJsxNode(node) && tagNameOf(node) === FOOTER_TAG) {
        const host = nearestJsxAncestor(node)
        if (host == null || tagNameOf(host) !== CONTENT_TAG) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          offenders.push(`${path}:${line + 1}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return offenders
}

const INLINE = `
<AlertDialogContent>
  <AlertDialogHeader />
  <AlertDialogFooter><AlertDialogCancel /></AlertDialogFooter>
</AlertDialogContent>
`
// A conditional footer still arrives as a direct child — the detector must not read the
// expression container as nesting, or every staged dialog becomes a false positive.
const CONDITIONAL = `
<AlertDialogContent>
  {stage === 'options' ? (
    <AlertDialogFooter><AlertDialogCancel /></AlertDialogFooter>
  ) : null}
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
// Textually inside the content, structurally one element down: the layout wrapper is
// enough to hide the footer from the partition.
const WRAPPED = `
<AlertDialogContent>
  <AlertDialogHeader />
  <View className="gap-2">
    <AlertDialogFooter><AlertDialogCancel /></AlertDialogFooter>
  </View>
</AlertDialogContent>
`

describe('every AlertDialogFooter renders where the primitive can pin it', () => {
  it('reads nesting, not position (detector is not vacuous)', () => {
    expect(
      findFootersOutsideContent([
        { path: 'ok-inline.tsx', src: INLINE },
        { path: 'ok-conditional.tsx', src: CONDITIONAL },
        { path: 'bad-pane.tsx', src: IN_A_PANE },
        { path: 'bad-wrapped.tsx', src: WRAPPED },
      ]),
    ).toEqual(['bad-pane.tsx:9', 'bad-wrapped.tsx:5'])
  })

  it('no shipped footer sits outside its content', async () => {
    const paths = await fg(['app/**/*.tsx', 'components/**/*.tsx'], {
      ignore: ['**/node_modules/**'],
      cwd: process.cwd(),
    })
    const files = paths.map((path) => ({ path, src: readFileSync(path, 'utf8') }))
    expect(
      findFootersOutsideContent(files),
      'render AlertDialogFooter as a direct child of AlertDialogContent — a footer nested in a body component, a View or a fragment scrolls with the body instead of staying pinned',
    ).toEqual([])
  })
})
