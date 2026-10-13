/**
 * Generates and validates the decision records: `docs/README.md`, the generated block in
 * `AGENTS.md`, ADR frontmatter and headings, `DECISION(slug)` anchors, doc paths named in source,
 * relative links in Markdown, and evidence coverage. The rules are in the bootstrap ADR,
 * docs/decisions/2026-10-12-decision-records.md.
 *
 *   node scripts/docs-check.ts            validate; fail on errors, including stale outputs
 *   node scripts/docs-check.ts --write    regenerate the outputs, then validate
 *   node scripts/docs-check.ts --strict   validate; warnings fail too (CI)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Lexer, marked, type Token, type Tokens } from 'marked'
import { parse as parseYaml } from 'yaml'

const DECISIONS_DIR = 'docs/decisions/'
const EVIDENCE_DIR = 'docs/evidence/'
const README = 'docs/README.md'
const AGENTS = 'AGENTS.md'
const TAGS_FILE = 'docs/decision-tags.yml'
const BEGIN_MARKER = '<!-- BEGIN GENERATED: decisions -->'
const END_MARKER = '<!-- END GENERATED: decisions -->'
const SUMMARY_MAX = 200
export const AGENTS_BLOCK_MAX_LINES = 40
const REGENERATE = 'run `npm run docs:gen` and commit the result'

const FRONTMATTER_KEYS = ['summary', 'tags', 'cross-cutting', 'active', 'superseded-by']
const REQUIRED_HEADINGS = [
  'Context and Problem Statement',
  'Considered Options',
  'Decision Outcome',
  'Consequences',
]

// Both name anchors and doc paths as examples, which exist only in the repos the tests build.
const SCAN_SKIP = new Set(['scripts/docs-check.ts', 'scripts/docs-check.test.ts'])

const FILENAME = /^(\d{4})-(\d{2})-(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ANCHOR = /DECISION\(([^)\n]*)\)/g
const DOC_PATH = /(?<![\w./-])docs\/[\w./-]*?\.md(?![\w-])(?:#[\w-]+)?/g
const HTML_ID = /<a\s(?:[^>]*\s)?(?:id|name)="([^"]+)"/g

type State = 'active' | 'deprecated' | 'superseded' | 'retired'

interface Adr {
  path: string
  slug: string
  summary: string
  tags: string[]
  crossCutting: boolean
  supersededBy: string | undefined
  state: State
}

export interface Result {
  ok: boolean
  errors: string[]
  warnings: string[]
  written: string[]
}

export function docsCheck(root: string, { write = false, strict = false } = {}): Result {
  const errors: string[] = []
  const warnings: string[] = []
  const written: string[] = []
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n')

  let files = listFiles(root)
  const tags = loadTags(root, files, errors)
  const adrs = files
    .filter((f) => f.startsWith(DECISIONS_DIR) && f.endsWith('.md'))
    .map((f) => parseAdr(f, read(f), tags, errors))
    .filter((a): a is Adr => a !== null)
    .sort(byFilename)
  const bySlug = indexAdrs(adrs, errors)

  const readme = renderReadme(adrs, tags, bySlug)
  const block = renderAgentsBlock(adrs)
  const blockLines = block.split('\n').length - 2
  if (blockLines > AGENTS_BLOCK_MAX_LINES) {
    errors.push(
      `${AGENTS}: the generated block is ${blockLines} lines, over the budget of ${AGENTS_BLOCK_MAX_LINES}; set cross-cutting: false on decisions not every change needs`,
    )
  }
  const agentsCurrent = existsSync(path.join(root, AGENTS)) ? read(AGENTS) : null
  const agents = agentsCurrent === null ? null : spliceBlock(agentsCurrent, block, errors)
  if (agentsCurrent === null)
    errors.push(`${AGENTS} is missing; create it with the ${BEGIN_MARKER} and ${END_MARKER} lines`)

  const outputs: [string, string | null][] = [
    [README, readme],
    [AGENTS, agents],
  ]
  for (const [file, content] of outputs) {
    if (content === null) continue
    const target = path.join(root, file)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current === content) continue
    if (write) {
      writeFileSync(target, content)
      written.push(file)
    } else {
      errors.push(`${file} is stale or was edited by hand; ${REGENERATE}`)
    }
  }
  if (written.length > 0) files = listFiles(root)

  const index = indexFiles(files)
  const slugCache = new Map<string, Set<string>>()
  const headingSlugsOf = (file: string) => {
    let slugs = slugCache.get(file)
    if (!slugs) slugCache.set(file, (slugs = headingSlugs(stripFrontmatter(read(file)))))
    return slugs
  }
  const resolve = (from: string, href: string) => resolveLink(from, href, index, headingSlugsOf)

  const evidenceLinks: string[] = []
  for (const file of files.filter((f) => f.endsWith('.md'))) {
    const isAdr = file.startsWith(DECISIONS_DIR)
    for (const href of markdownLinks(stripFrontmatter(read(file)))) {
      const link = resolve(file, href)
      if (link === null) continue
      if (link.error) errors.push(`${file}: ${link.error}`)
      else if (isAdr && `${link.target}/`.startsWith(EVIDENCE_DIR)) evidenceLinks.push(link.target)
    }
  }

  for (const file of files) {
    if (file.startsWith('docs/') || file.endsWith('.md') || SCAN_SKIP.has(file)) continue
    const buffer = readFileSync(path.join(root, file))
    if (buffer.subarray(0, 8000).includes(0)) continue
    const text = buffer.toString('utf8')
    if (!text.includes('DECISION(') && !text.includes('docs/')) continue
    text.split('\n').forEach((line, i) => {
      const where = `${file}:${i + 1}`
      for (const [, raw] of line.matchAll(ANCHOR)) {
        const problem = anchorProblem(raw.trim(), bySlug)
        if (problem) errors.push(`${where}: ${problem}`)
      }
      for (const [ref] of line.matchAll(DOC_PATH)) {
        const link = resolve('', ref)
        if (link?.error) errors.push(`${where}: ${link.error}; point it at the current doc or ADR`)
      }
    })
  }

  for (const file of files.filter((f) => f.startsWith(EVIDENCE_DIR))) {
    const covered = evidenceLinks.some((t) => file === t || file.startsWith(`${t}/`))
    if (!covered) {
      warnings.push(
        `${file}: no ADR links to this evidence; link it or its folder from an ADR, or delete it`,
      )
    }
  }

  return {
    ok: errors.length === 0 && (!strict || warnings.length === 0),
    errors,
    warnings,
    written,
  }
}

function listFiles(root: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    },
  ).toString('utf8')
  const files = new Set(out.split('\0').filter((f) => f && existsSync(path.join(root, f))))
  return [...files].sort()
}

function indexFiles(files: string[]) {
  const dirs = new Set([''])
  for (const file of files) {
    for (let i = file.indexOf('/'); i !== -1; i = file.indexOf('/', i + 1))
      dirs.add(file.slice(0, i))
  }
  return { files: new Set(files), dirs }
}

function loadTags(root: string, files: string[], errors: string[]): Map<string, string> {
  const tags = new Map<string, string>()
  if (!files.includes(TAGS_FILE)) {
    errors.push(`${TAGS_FILE} is missing; create it as a map of tag to one-line description`)
    return tags
  }
  let data: unknown
  try {
    data = parseYaml(readFileSync(path.join(root, TAGS_FILE), 'utf8'))
  } catch (e) {
    errors.push(`${TAGS_FILE}: not valid YAML: ${firstLine(e)}`)
    return tags
  }
  if (data === null || data === undefined) return tags
  if (!isRecord(data)) {
    errors.push(`${TAGS_FILE}: must be a map of tag to one-line description`)
    return tags
  }
  for (const [tag, description] of Object.entries(data)) {
    if (!SLUG.test(tag)) errors.push(`${TAGS_FILE}: tag "${tag}" must be lowercase kebab-case`)
    if (typeof description !== 'string' || !description.trim()) {
      errors.push(`${TAGS_FILE}: tag "${tag}" needs a one-line description`)
    }
    tags.set(tag, typeof description === 'string' ? oneLine(description) : '')
  }
  return tags
}

function parseAdr(
  file: string,
  text: string,
  vocabulary: Map<string, string>,
  errors: string[],
): Adr | null {
  const name = path.posix.basename(file)
  const match = FILENAME.exec(name)
  if (!match) {
    errors.push(`${file}: name it YYYY-MM-DD-slug.md, with a lowercase kebab-case slug`)
    return null
  }
  const [, year, month, day, slug] = match
  if (!isRealDate(Number(year), Number(month), Number(day))) {
    errors.push(`${file}: ${year}-${month}-${day} is not a real date; fix the filename`)
  }
  const fail = (message: string) => errors.push(`${file}: ${message}`)

  const { data, body } = splitFrontmatter(text)
  let fm: unknown = null
  if (data === null) {
    fail('missing frontmatter; copy it from docs/adr-template.md')
  } else {
    try {
      fm = parseYaml(data) ?? {}
    } catch (e) {
      fail(`frontmatter is not valid YAML: ${firstLine(e)}`)
    }
  }
  const front = isRecord(fm) ? fm : {}
  if (fm !== null && !isRecord(fm)) fail('frontmatter must be a map of fields')

  for (const key of Object.keys(front)) {
    if (!FRONTMATTER_KEYS.includes(key)) {
      fail(`unknown frontmatter key "${key}"; allowed: ${FRONTMATTER_KEYS.join(', ')}`)
    }
  }

  let summary = ''
  if (typeof front.summary === 'string' && front.summary.trim()) {
    summary = oneLine(front.summary)
    if (summary.length > SUMMARY_MAX) {
      fail(`summary is ${summary.length} characters; shorten it to ${SUMMARY_MAX}`)
    }
  } else {
    fail('summary is required: the ruling in one or two imperative sentences')
  }

  let tags: string[] = []
  if (front.tags !== undefined && front.tags !== null) {
    if (Array.isArray(front.tags) && front.tags.every((t) => typeof t === 'string')) {
      tags = [...new Set(front.tags as string[])]
      for (const tag of tags) {
        if (!vocabulary.has(tag)) {
          fail(`tag "${tag}" is not in ${TAGS_FILE}; use a listed tag or add it there`)
        }
      }
    } else {
      fail('tags must be a list of strings')
    }
  }

  let crossCutting = false
  if (front['cross-cutting'] !== undefined) {
    if (typeof front['cross-cutting'] === 'boolean') crossCutting = front['cross-cutting']
    else fail('cross-cutting must be true or false')
  }

  let supersededBy: string | undefined
  const successor = front['superseded-by']
  if (successor !== undefined && successor !== null && successor !== '') {
    if (typeof successor === 'string' && SLUG.test(successor)) supersededBy = successor
    else fail('superseded-by must be the slug of another ADR, without its date')
  }

  let active = supersededBy === undefined
  if (front.active !== undefined) {
    if (typeof front.active === 'boolean') active = front.active
    else fail('active must be true or false')
  }

  const tokens = Lexer.lex(body)
  const headings = tokens.filter((t): t is Tokens.Heading => t.type === 'heading')
  for (const heading of REQUIRED_HEADINGS) {
    if (!headings.some((h) => plainText(h.tokens) === heading)) {
      fail(`missing the "${heading}" heading; see docs/adr-template.md`)
    }
  }
  const consequences = tokens.findIndex(
    (t) => t.type === 'heading' && plainText(t.tokens) === 'Consequences',
  )
  if (consequences !== -1) {
    const depth = (tokens[consequences] as Tokens.Heading).depth
    let accepted = false
    for (const token of tokens.slice(consequences + 1)) {
      if (token.type === 'heading' && token.depth <= depth) break
      if (token.type === 'list') {
        accepted ||= (token as Tokens.List).items.some((i) => i.text.startsWith('Bad, because'))
      }
    }
    if (!accepted) fail('Consequences needs a "* Bad, because …" item naming the accepted downside')
  }

  const state: State = active
    ? supersededBy
      ? 'deprecated'
      : 'active'
    : supersededBy
      ? 'superseded'
      : 'retired'
  return { path: file, slug, summary, tags, crossCutting, supersededBy, state }
}

function indexAdrs(adrs: Adr[], errors: string[]): Map<string, Adr> {
  const bySlug = new Map<string, Adr>()
  for (const adr of adrs) {
    const other = bySlug.get(adr.slug)
    if (other) {
      errors.push(`${adr.path}: slug "${adr.slug}" is already used by ${other.path}; rename one`)
    } else {
      bySlug.set(adr.slug, adr)
    }
  }

  for (const adr of adrs) {
    if (!adr.supersededBy) continue
    const successor = bySlug.get(adr.supersededBy)
    if (!successor) {
      errors.push(`${adr.path}: superseded-by names "${adr.supersededBy}", which no ADR has`)
      continue
    }
    if (adr.state === 'deprecated' && successor.state !== 'active') {
      errors.push(
        `${adr.path}: deprecated, but its successor ${successor.slug} is ${successor.state}; point superseded-by at an active ADR`,
      )
    }
    const chain = [adr.slug]
    for (let next: Adr | undefined = successor; next; next = bySlug.get(next.supersededBy ?? '')) {
      if (chain.includes(next.slug)) {
        errors.push(
          `${adr.path}: superseded-by loops (${[...chain, next.slug].join(' → ')}); break the cycle`,
        )
        break
      }
      chain.push(next.slug)
    }
  }
  return bySlug
}

function anchorProblem(slug: string, bySlug: Map<string, Adr>): string | null {
  const adr = bySlug.get(slug)
  if (!adr) return `DECISION(${slug}) names no ADR; fix the slug or write the ADR`
  if (adr.state === 'superseded') {
    return `DECISION(${slug}) names a superseded ADR; bring the code in line with ${terminal(adr, bySlug)} and update the anchor`
  }
  if (adr.state === 'retired') {
    return `DECISION(${slug}) names a retired ADR; remove the anchor`
  }
  return null
}

function terminal(adr: Adr, bySlug: Map<string, Adr>): string {
  const seen = new Set<string>()
  let current = adr
  while (current.supersededBy && !seen.has(current.slug)) {
    seen.add(current.slug)
    const next = bySlug.get(current.supersededBy)
    if (!next) break
    current = next
  }
  return current.slug
}

function renderReadme(adrs: Adr[], tags: Map<string, string>, bySlug: Map<string, Adr>): string {
  const listed = adrs.filter((a) => a.state === 'active' || a.state === 'deprecated')
  const entry = (adr: Adr) => {
    const link = `[${adr.slug}](${relativeToDocs(adr.path)})`
    const successor = adr.state === 'deprecated' ? bySlug.get(adr.supersededBy ?? '') : undefined
    const mark = successor
      ? `**Deprecated → [${successor.slug}](${relativeToDocs(successor.path)}).** `
      : ''
    return `- ${mark}${adr.summary} ${link}`
  }

  const lines = [
    '# Decisions',
    '',
    '> Generated by `scripts/docs-check.ts` from decision frontmatter. Do not edit; change the',
    '> decision records and run `npm run docs:gen`.',
    '',
    'For the map of the code, read [ARCHITECTURE.md](ARCHITECTURE.md).',
    '',
    'Each entry is a decision in force: its ruling, then the record that explains it. New decisions',
    'start from [adr-template.md](adr-template.md).',
  ]
  const section = (heading: string, entries: Adr[]) => {
    if (entries.length > 0) lines.push('', `## ${heading}`, '', ...entries.map(entry))
  }
  for (const [tag, description] of tags) {
    section(
      `${tag}: ${description}`,
      listed.filter((a) => a.tags.includes(tag)),
    )
  }
  section(
    'General',
    listed.filter((a) => a.tags.length === 0),
  )
  if (listed.length === 0) lines.push('', 'No decisions recorded yet.')
  return `${lines.join('\n')}\n`
}

function renderAgentsBlock(adrs: Adr[]): string {
  const entries = adrs
    .filter((a) => a.state === 'active' && a.crossCutting)
    .map((a) => `- ${a.summary} [${a.slug}](${a.path})`)
  return [
    BEGIN_MARKER,
    '<!-- Generated by `npm run docs:gen` from cross-cutting decisions. Do not edit. -->',
    '',
    ...(entries.length > 0 ? entries : ['- No cross-cutting decisions yet.']),
    '',
    END_MARKER,
  ].join('\n')
}

function spliceBlock(agents: string, block: string, errors: string[]): string | null {
  const lines = agents.split('\n')
  const begins = lines.flatMap((l, i) => (l.trim() === BEGIN_MARKER ? [i] : []))
  const ends = lines.flatMap((l, i) => (l.trim() === END_MARKER ? [i] : []))
  if (begins.length !== 1 || ends.length !== 1 || begins[0] > ends[0]) {
    errors.push(
      `${AGENTS}: needs exactly one ${BEGIN_MARKER} line followed by one ${END_MARKER} line; restore them and ${REGENERATE}`,
    )
    return null
  }
  return [...lines.slice(0, begins[0]), block, ...lines.slice(ends[0] + 1)].join('\n')
}

interface Link {
  target: string
  error?: string
}

function resolveLink(
  from: string,
  href: string,
  index: { files: Set<string>; dirs: Set<string> },
  headingSlugsOf: (file: string) => Set<string>,
): Link | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null
  const hash = href.indexOf('#')
  const pathPart = (hash === -1 ? href : href.slice(0, hash)).split('?')[0]
  const fragment = hash === -1 ? '' : safeDecode(href.slice(hash + 1))
  const decoded = safeDecode(pathPart)
  const target = (
    decoded === ''
      ? from
      : decoded.startsWith('/')
        ? path.posix.normalize(decoded.slice(1))
        : path.posix.join(path.posix.dirname(from), decoded)
  ).replace(/\/$|^\.$/, '')

  if (target.startsWith('..')) return { target, error: `${href} points outside the repository` }
  if (!index.files.has(target) && !index.dirs.has(target)) {
    return { target, error: `${href} does not exist` }
  }
  if (fragment && index.files.has(target) && target.endsWith('.md')) {
    if (!headingSlugsOf(target).has(fragment)) {
      return { target, error: `${href}: ${target} has no heading or anchor "#${fragment}"` }
    }
  }
  return { target }
}

function markdownLinks(text: string): string[] {
  const hrefs: string[] = []
  marked.walkTokens(Lexer.lex(text), (token) => {
    if (token.type === 'link' || token.type === 'image') hrefs.push(token.href)
  })
  return hrefs
}

function headingSlugs(text: string): Set<string> {
  const slugs = new Set<string>()
  const counts = new Map<string, number>()
  marked.walkTokens(Lexer.lex(text), (token) => {
    if (token.type !== 'heading') return
    const base = slugify(plainText(token.tokens))
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    slugs.add(n === 0 ? base : `${base}-${n}`)
  })
  for (const [, id] of text.matchAll(HTML_ID)) slugs.add(id)
  return slugs
}

/** GitHub's heading anchor, without the duplicate suffix. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

function plainText(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((t) => {
      if (t.type === 'html') return ''
      if ('tokens' in t && t.tokens) return plainText(t.tokens)
      return 'text' in t && typeof t.text === 'string' ? t.text : ''
    })
    .join('')
}

function splitFrontmatter(text: string): { data: string | null; body: string } {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { data: null, body: normalized }
  const end = normalized.indexOf('\n---', 3)
  if (end === -1 || !/^\n---(\n|$)/.test(normalized.slice(end, end + 5))) {
    return { data: null, body: normalized }
  }
  return { data: normalized.slice(4, end + 1), body: normalized.slice(end + 4) }
}

function stripFrontmatter(text: string): string {
  return splitFrontmatter(text).body
}

function relativeToDocs(file: string): string {
  return file.slice('docs/'.length)
}

function byFilename(a: Adr, b: Adr): number {
  const x = path.posix.basename(a.path)
  const y = path.posix.basename(b.path)
  if (x !== y) return x < y ? -1 : 1
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function firstLine(error: unknown): string {
  return String(error instanceof Error ? error.message : error).split('\n')[0]
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const unknown = args.find((a) => a !== '--write' && a !== '--strict')
  if (unknown) {
    console.error(`docs-check: unknown argument ${unknown}; use --write and/or --strict`)
    process.exit(2)
  }
  const root = path.resolve(import.meta.dirname, '..')
  const result = docsCheck(root, {
    write: args.includes('--write'),
    strict: args.includes('--strict'),
  })
  for (const file of result.written) console.log(`docs-check: wrote ${file}`)
  for (const error of result.errors) console.error(`error: ${error}`)
  for (const warning of result.warnings) console.error(`warning: ${warning}`)
  if (result.ok) console.log('docs-check: ok')
  else process.exitCode = 1
}
