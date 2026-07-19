import { type Root } from 'postcss'
import safeParser from 'postcss-safe-parser'

import { createDomPurify, NAVIGATION_FORBID_ATTRS } from './purify-instance'

// The plain path's attribute-level exfiltration policy, applied uniformly to
// stylesheet content: no external fetches, no legacy executable CSS. Checked
// after comment-stripping so url(/**/…) can't slip through.
const BANNED_VALUE = /url\(|expression\(|behavior/i
const KEPT_AT_RULES = new Set(['media', 'keyframes'])

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

function scrubRoot(root: Root): void {
  root.walkAtRules((atRule) => {
    const name = atRule.name.toLowerCase().replace(/^-\w+-/, '')
    if (!KEPT_AT_RULES.has(name)) atRule.remove()
  })
  root.walkDecls((decl) => {
    if (BANNED_VALUE.test(stripComments(`${decl.prop}:${decl.value}`))) decl.remove()
  })
}

// `</style>` inside a serialized stylesheet would terminate the element on
// re-parse; CSS-escaping `<` neutralizes breakout without changing semantics.
function escapeStyleText(css: string): string {
  return css.replace(/</g, '\\3c ')
}

function scrubStylesheet(css: string): string {
  try {
    const root = safeParser(css)
    scrubRoot(root)
    return escapeStyleText(root.toString())
  } catch {
    return ''
  }
}

function scrubDeclarationList(style: string): string {
  try {
    const root = safeParser(`*{${style}}`)
    scrubRoot(root)
    const decls: string[] = []
    root.walkDecls((decl) => {
      decls.push(`${decl.prop}: ${decl.value}`)
    })
    return escapeStyleText(decls.join('; '))
  } catch {
    return ''
  }
}

const purify = createDomPurify()

purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'style') return
  node.textContent = scrubStylesheet(node.textContent ?? '')
})

purify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName !== 'style') return
  const safe = scrubDeclarationList(data.attrValue)
  if (safe.length === 0) {
    data.keepAttr = false
    return
  }
  data.attrValue = safe
})

// Rich path: no juice (real stylesheets work in isolated documents), <style>
// allowed, CSS scrubbed by a real parser on both stylesheet and attribute
// content. Web-bundle-only — native runs this inside the DOM component's
// WebView document (see rich-sanitize.native.ts).
export function sanitizeRichHtml(html: string): string {
  // FORCE_BODY: a leading <style> is otherwise hoisted into <head> by the
  // parser and silently dropped from the body-only output.
  return purify.sanitize(html, {
    ADD_TAGS: ['style'],
    FORBID_ATTR: NAVIGATION_FORBID_ATTRS,
    FORCE_BODY: true,
  })
}
