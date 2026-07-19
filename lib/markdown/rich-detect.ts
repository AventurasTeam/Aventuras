import { CSSProcessor } from '@native-html/css-processor'
import { defaultHTMLElementModels } from '@native-html/transient-render-engine'
import { Parser } from 'htmlparser2'

const processor = new CSSProcessor()

// Structural wrappers the TRE consumes without an element model of their own.
const STRUCTURAL_TAGS = new Set(['html', 'head', 'body', 'title'])

// Core RNRH has an element model for <table> but no tabular renderer (the
// official table plugin is itself WebView-based) — pinned rich by spec intent.
const FORCED_RICH_TAGS = new Set(['table'])

const ADVANCED_AT_RULE = /@media|@keyframes|@import/i

const elementModels: Record<string, unknown> = defaultHTMLElementModels

function declarationTranslates(declaration: string): boolean {
  if (declaration.trim().length === 0) return true
  try {
    const { native } = processor.compileInlineCSS(declaration)
    return (
      Object.keys(native.block.retain).length +
        Object.keys(native.block.flow).length +
        Object.keys(native.text.retain).length +
        Object.keys(native.text.flow).length >
      0
    )
  } catch {
    return false
  }
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

// Splits a declaration list on top-level semicolons (quote-aware).
function splitDeclarations(block: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of block) {
    if (quote != null) {
      if (ch === quote) quote = null
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ';') {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out.filter((decl) => decl.trim().length > 0)
}

type CssRule = { prelude: string; body: string }

// Minimal top-level rule tokenizer for the detector only (the scrub uses
// postcss). Any shape it cannot make sense of must read as "rich", never
// "plain" — the accepted failure direction is an unnecessary WebView.
function tokenizeTopLevelRules(css: string): CssRule[] | null {
  const src = stripCssComments(css)
  const rules: CssRule[] = []
  let i = 0
  while (i < src.length) {
    const braceStart = src.indexOf('{', i)
    if (braceStart === -1) {
      return src.slice(i).trim().length === 0 ? rules : null
    }
    const prelude = src.slice(i, braceStart).trim()
    let depth = 1
    let j = braceStart + 1
    let quote: string | null = null
    while (j < src.length && depth > 0) {
      const ch = src[j]!
      if (quote != null) {
        if (ch === quote) quote = null
      } else if (ch === '"' || ch === "'") {
        quote = ch
      } else if (ch === '{') {
        depth += 1
      } else if (ch === '}') {
        depth -= 1
      }
      j += 1
    }
    if (depth !== 0) return null
    rules.push({ prelude, body: src.slice(braceStart + 1, j - 1) })
    i = j
  }
  return rules
}

function styleElementIsRich(cssText: string): boolean {
  if (ADVANCED_AT_RULE.test(cssText)) return true
  const rules = tokenizeTopLevelRules(cssText)
  if (rules == null) return true
  for (const rule of rules) {
    if (rule.prelude.startsWith('@')) return true
    if (rule.prelude.includes(':')) return true
    if (splitDeclarations(rule.body).some((decl) => !declarationTranslates(decl))) return true
  }
  return false
}

/**
 * True when the marked output (pre-juice) contains anything the installed
 * RNRH engine cannot translate — the entry then renders through the isolated
 * document path instead of the plain RNRH tail.
 */
export function detectRichEntryHtml(markedHtml: string): boolean {
  let rich = false
  let styleDepth = 0
  let styleText = ''
  const parser = new Parser({
    onopentag(name, attribs) {
      if (rich) return
      if (name === 'style') {
        styleDepth += 1
        return
      }
      if (
        FORCED_RICH_TAGS.has(name) ||
        (!STRUCTURAL_TAGS.has(name) && elementModels[name] == null)
      ) {
        rich = true
        return
      }
      const style = attribs['style']
      if (style != null) {
        const declarations = splitDeclarations(stripCssComments(style))
        if (declarations.some((decl) => !declarationTranslates(decl))) rich = true
      }
    },
    ontext(text) {
      if (styleDepth > 0) styleText += text
    },
    onclosetag(name) {
      if (name !== 'style' || styleDepth === 0) return
      styleDepth -= 1
      if (!rich && styleElementIsRich(styleText)) rich = true
      styleText = ''
    },
  })
  parser.write(markedHtml)
  parser.end()
  return rich
}
