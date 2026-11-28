/**
 * Generates and validates the decision records: `docs/README.md`, the generated blocks in the
 * root and scoped `AGENTS.md` files, ADR frontmatter and headings, merged summaries, `ADR(slug)`
 * anchors, doc paths named in source, relative links in Markdown, and evidence coverage. The rules
 * are in the bootstrap ADR, docs/decisions/2026-10-12-decision-records.md.
 *
 *   node scripts/docs-check.ts               validate; fail on errors, including stale outputs
 *   node scripts/docs-check.ts --write       regenerate the outputs, then validate
 *   node scripts/docs-check.ts --strict      validate; warnings fail too, except notices (CI)
 *   node scripts/docs-check.ts --base <ref>  compare merged summaries with <ref> (origin/master)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Lexer, marked, type Token, type Tokens } from 'marked'
import { parse as parseYaml } from 'yaml'

export const AGENTS_BLOCK_MAX_LINES = 40

const DECISIONS_DIR = 'docs/decisions/'
const EVIDENCE_DIR = 'docs/evidence/'
const README = 'docs/README.md'
const AGENTS = 'AGENTS.md'
const TAGS_FILE = 'docs/decision-tags.yml'
const BEGIN_MARKER = '<!-- BEGIN GENERATED: decisions -->'
const END_MARKER = '<!-- END GENERATED: decisions -->'
// A summary should fit one 120-column line of the generated list after its `- `; a second,
// indented line is fine. Past two it draws a notice, and past the maximum it is a paragraph.
const SUMMARY_AIM = 118
const SUMMARY_WARN = 236
const SUMMARY_MAX = 512
// Past this many entries a tag's section is too long to scan; its tag should be split.
const SECTION_MAX = 20
const REGENERATE = 'run `npm run docs:gen` and commit the result'

const FRONTMATTER_KEYS = ['summary', 'tags', 'scope', 'cross-cutting', 'active', 'superseded-by']
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
const ANCHOR = /\bADR\(([^)\n]*)\)/g
const DOC_PATH = /(?<![\w./-])docs\/[\w./-]*?\.md(?![\w-])(?:#[\w-]+)?/g
const HTML_ID = /<a\s(?:[^>]*\s)?(?:id|name)="([^"]+)"/g
const GLOB = /[*?[\]{}!\\]/

type State = 'active' | 'deprecated' | 'superseded' | 'retired'

interface Adr {
  path: string
  slug: string
  summary: string
  tags: string[]
  scope: string[]
  crossCutting: boolean
  supersededBy: string | undefined
  state: State
}

export interface Result {
  ok: boolean
  errors: string[]
  warnings: string[]
  /** Warnings that fail nothing, even under --strict. */
  notices: string[]
  written: string[]
  removed: string[]
}

export interface Options {
  write?: boolean
  strict?: boolean
  /** The ref whose merged ADRs' summaries must not change. Without one, that check is skipped. */
  base?: string
}

export function docsCheck(
  root: string,
  { write = false, strict = false, base }: Options = {},
): Result {
  const errors: string[] = []
  const warnings: string[] = []
  const notices: string[] = []
  const written: string[] = []
  const removed: string[] = []
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

  let files = listFiles(root)
  const tags = loadTags(root, files, errors)
  const adrs = files
    .filter((f) => f.startsWith(DECISIONS_DIR) && f.endsWith('.md'))
    .map((f) => parseAdr(f, read(f), tags, errors, notices))
    .filter((a): a is Adr => a !== null)
    .sort(byFilename)
  const bySlug = indexAdrs(adrs, errors)
  if (base) checkMergedSummaries(root, base, bySlug, errors, notices)

  const scoped = new Map<string, Adr[]>()
  const { dirs } = indexFiles(files)
  for (const adr of adrs) {
    for (const dir of adr.scope) {
      if (!dirs.has(dir)) {
        errors.push(`${adr.path}: scope ${dir} is not a directory in the repository; update scope`)
      } else if (isListed(adr)) {
        scoped.set(dir, [...(scoped.get(dir) ?? []), adr])
      }
    }
  }

  const readme = renderReadme(adrs, tags, bySlug)
  const block = renderAgentsBlock(adrs)
  const blockLines = block.split('\n').length - 2
  if (blockLines > AGENTS_BLOCK_MAX_LINES) {
    errors.push(
      `${AGENTS}: the generated block is ${blockLines} lines, over the budget of ${AGENTS_BLOCK_MAX_LINES}; set cross-cutting: false on decisions not every change needs`,
    )
  }
  const agentsCurrent = existsSync(path.join(root, AGENTS)) ? read(AGENTS) : null
  const agents =
    agentsCurrent === null ? null : spliceBlock(agentsCurrent, block, AGENTS, false, errors)
  if (agentsCurrent === null)
    errors.push(`${AGENTS} is missing; create it with the ${BEGIN_MARKER} and ${END_MARKER} lines`)

  const outputs: [string, string | null][] = [
    [README, readme],
    [AGENTS, agents],
  ]
  const removals: string[] = []
  // An AGENTS.md that no ADR scopes any more still carries the markers, so it is found here.
  const marked = files
    .filter(
      (f) => f !== AGENTS && path.posix.basename(f) === AGENTS && read(f).includes(BEGIN_MARKER),
    )
    .map((f) => path.posix.dirname(f))
  for (const dir of [...new Set([...scoped.keys(), ...marked])].sort()) {
    const file = `${dir}/${AGENTS}`
    const current = existsSync(path.join(root, file)) ? read(file) : null
    const heading = `# \`${dir}\``
    const entries = scoped.get(dir)
    if (entries) {
      const scopeBlock = renderScopeBlock(dir, entries, bySlug)
      outputs.push([
        file,
        current === null
          ? `${heading}\n\n${scopeBlock}\n`
          : spliceBlock(current, scopeBlock, file, true, errors),
      ])
    } else if (current !== null) {
      const rest = spliceBlock(current, null, file, false, errors)
      if (rest === null) continue
      // Only what --write itself created is deleted; any hand-written text keeps the file.
      if (rest.trim() === heading || rest.trim() === '') removals.push(file)
      else outputs.push([file, rest])
    }
  }

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
  for (const file of removals) {
    if (write) {
      unlinkSync(path.join(root, file))
      removed.push(file)
    } else {
      errors.push(`${file} holds only a generated block that no ADR scopes any more; ${REGENERATE}`)
    }
  }
  if (written.length > 0 || removed.length > 0) files = listFiles(root)

  const anchored = new Set<string>()
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
      else if (isAdr && link.target.startsWith(EVIDENCE_DIR)) evidenceLinks.push(link.target)
    }
  }

  for (const file of files) {
    if (file.startsWith('docs/') || file.endsWith('.md') || SCAN_SKIP.has(file)) continue
    const buffer = readFileSync(path.join(root, file))
    if (buffer.subarray(0, 8000).includes(0)) continue
    const text = buffer.toString('utf8')
    if (!text.includes('ADR(') && !text.includes('docs/')) continue
    text.split('\n').forEach((line, i) => {
      const where = `${file}:${i + 1}`
      for (const [, raw] of line.matchAll(ANCHOR)) {
        anchored.add(raw.trim())
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

  for (const adr of adrs) {
    if (adr.tags.length > 0 || adr.scope.length > 0 || anchored.has(adr.slug)) continue
    if (adr.state === 'active' && !adr.crossCutting) {
      warnings.push(
        `${adr.path}: no tag, no scope and no ADR(${adr.slug}) anchor, so nothing leads here; tag it, scope it to the directory it governs, or anchor it in the code`,
      )
    } else if (adr.state === 'deprecated') {
      notices.push(
        `${adr.path}: deprecated, and no code anchors it any more; if nothing still follows it, set active: false`,
      )
    }
  }
  const listed = adrs.filter(isListed)
  for (const tag of tags.keys()) {
    const count = listed.filter((a) => a.tags.includes(tag)).length
    if (count > SECTION_MAX) {
      notices.push(
        `${README}: ${tag} lists ${count} decisions, over ${SECTION_MAX}; split it in ${TAGS_FILE}`,
      )
    }
  }

  return {
    ok: errors.length === 0 && (!strict || warnings.length === 0),
    errors,
    warnings,
    notices,
    written,
    removed,
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
  notices: string[],
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
      fail(
        `summary is ${summary.length} characters, over the limit of ${SUMMARY_MAX}; it is the ruling, not a paragraph: aim for under ${SUMMARY_AIM}`,
      )
    } else if (summary.length > SUMMARY_WARN) {
      notices.push(
        `${file}: summary is ${summary.length} characters, past two lines; aim for under ${SUMMARY_AIM}`,
      )
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

  let scope: string[] = []
  if (front.scope !== undefined && front.scope !== null) {
    if (Array.isArray(front.scope) && front.scope.every((s) => typeof s === 'string')) {
      for (const raw of front.scope as string[]) {
        const dir = raw.trim().replace(/\/+$/, '')
        if (dir === '' || dir === '.') {
          fail(
            `scope "${raw}" is the repository root; use tags or cross-cutting for rules that apply everywhere`,
          )
        } else if (
          GLOB.test(dir) ||
          dir.startsWith('/') ||
          dir.split('/').some((s) => s === '' || s === '.' || s === '..')
        ) {
          fail(`scope "${raw}" must be a repository-relative directory, without globs or ".."`)
        } else {
          scope.push(dir)
        }
      }
      scope = [...new Set(scope)]
    } else {
      fail('scope must be a list of directories')
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
  return { path: file, slug, summary, tags, scope, crossCutting, supersededBy, state }
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
  if (!adr) return `ADR(${slug}) names no ADR; fix the slug or write the ADR`
  if (adr.state === 'superseded') {
    return `ADR(${slug}) names a superseded ADR; bring the code in line with ${terminal(adr, bySlug)} and update the anchor`
  }
  if (adr.state === 'retired') {
    return `ADR(${slug}) names a retired ADR; remove the anchor`
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

function isListed(adr: Adr): boolean {
  return adr.state === 'active' || adr.state === 'deprecated'
}

/** One generated list line, with links relative to `from`, the directory of the output. */
function entry(adr: Adr, from: string, bySlug: Map<string, Adr>): string {
  const href = (target: Adr) => path.posix.relative(from, target.path)
  const successor = adr.state === 'deprecated' ? bySlug.get(adr.supersededBy ?? '') : undefined
  const mark = successor ? `**Deprecated → [${successor.slug}](${href(successor)}).** ` : ''
  return `- ${mark}${adr.summary} [${adr.slug}](${href(adr)})`
}

function renderReadme(adrs: Adr[], tags: Map<string, string>, bySlug: Map<string, Adr>): string {
  const tagged = adrs.filter((a) => isListed(a) && a.tags.length > 0)
  const lines = [
    '# Decisions',
    '',
    '> Generated by `scripts/docs-check.ts` from decision frontmatter. Do not edit; change the',
    '> decision records and run `npm run docs:gen`.',
    '',
    'For the map of the code, read [ARCHITECTURE.md](ARCHITECTURE.md).',
    '',
    'Each entry is a tagged decision in force: its ruling, then the record that explains it.',
    'Untagged decisions are local to one area and are not listed here; the code they govern leads to',
    'them, through the `AGENTS.md` their `scope` generates or an `ADR(slug)` comment. New decisions',
    'start from [adr-template.md](adr-template.md).',
  ]
  for (const [tag, description] of tags) {
    const entries = tagged.filter((a) => a.tags.includes(tag))
    if (entries.length > 0) {
      lines.push(
        '',
        `## ${tag}: ${description}`,
        '',
        ...entries.map((a) => entry(a, 'docs', bySlug)),
      )
    }
  }
  if (tagged.length === 0) lines.push('', 'No tagged decisions yet.')
  return `${lines.join('\n')}\n`
}

function renderScopeBlock(dir: string, adrs: Adr[], bySlug: Map<string, Adr>): string {
  return [
    BEGIN_MARKER,
    '<!-- Generated by `npm run docs:gen` from the decisions scoped to this directory. Do not edit. -->',
    '',
    'Decisions that govern this directory and everything under it. Read the record before changing',
    'what it covers.',
    '',
    ...adrs.map((a) => entry(a, dir, bySlug)),
    '',
    END_MARKER,
  ].join('\n')
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

/**
 * Replaces the generated block in `text` with `block`, or removes it, markers and all, when `block`
 * is null. With `append`, a file without markers gets the block at its end.
 */
function spliceBlock(
  text: string,
  block: string | null,
  file: string,
  append: boolean,
  errors: string[],
): string | null {
  const lines = text.split('\n')
  const begins = lines.flatMap((l, i) => (l.trim() === BEGIN_MARKER ? [i] : []))
  const ends = lines.flatMap((l, i) => (l.trim() === END_MARKER ? [i] : []))
  if (append && block !== null && begins.length === 0 && ends.length === 0) {
    return `${text.trimEnd()}\n\n${block}\n`
  }
  if (begins.length !== 1 || ends.length !== 1 || begins[0] > ends[0]) {
    errors.push(
      `${file}: needs exactly one ${BEGIN_MARKER} line followed by one ${END_MARKER} line; restore them and ${REGENERATE}`,
    )
    return null
  }
  if (block !== null) {
    return [...lines.slice(0, begins[0]), block, ...lines.slice(ends[0] + 1)].join('\n')
  }
  const before = lines.slice(0, begins[0]).join('\n').trimEnd()
  // Only blank lines go: the first line after the block may be indented code.
  const after = lines
    .slice(ends[0] + 1)
    .join('\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .trimEnd()
  return `${[before, after].filter(Boolean).join('\n\n')}\n`
}

/**
 * A merged ADR's summary is its ruling: it never changes, and its slug never disappears. Compares
 * against the merge-base with `base`, reading only the frontmatter there, so history is never
 * held to today's tags or headings.
 */
function checkMergedSummaries(
  root: string,
  base: string,
  bySlug: Map<string, Adr>,
  errors: string[],
  notices: string[],
): void {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    }).toString('utf8')
  let mergeBase: string
  try {
    mergeBase = git('merge-base', 'HEAD', base).trim()
  } catch {
    notices.push(`no merge-base with ${base}, so merged summaries were not checked; fetch ${base}`)
    return
  }
  const merged = git('ls-tree', '-r', '-z', '--name-only', mergeBase, '--', DECISIONS_DIR)
    .split('\0')
    .filter((f) => f.endsWith('.md'))
  for (const file of merged) {
    const match = FILENAME.exec(path.posix.basename(file))
    if (!match) continue
    const { data } = splitFrontmatter(git('show', `${mergeBase}:${file}`))
    let front: unknown = null
    try {
      front = data === null ? null : parseYaml(data)
    } catch {
      continue
    }
    if (!isRecord(front) || typeof front.summary !== 'string' || !front.summary.trim()) continue
    const summary = oneLine(front.summary)
    const current = bySlug.get(match[4])
    if (!current) {
      errors.push(
        `${file}: merged ADR ${match[4]} was removed or renamed; restore it, and retire it with active: false instead`,
      )
    } else if (current.summary && current.summary !== summary) {
      errors.push(
        `${current.path}: the summary of a merged ADR is its ruling and must stay "${summary}"; restore it, and supersede the ADR to change the ruling`,
      )
    }
  }
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
  // As github-slugger does, a suffix that would repeat an earlier slug is skipped.
  const occurrences = new Map<string, number>()
  marked.walkTokens(Lexer.lex(text), (token) => {
    if (token.type === 'html') {
      for (const [, id] of token.raw.matchAll(HTML_ID)) slugs.add(id)
    }
    if (token.type !== 'heading') return
    const base = slugify(plainText(token.tokens))
    let slug = base
    while (occurrences.has(slug)) {
      const n = (occurrences.get(base) ?? 0) + 1
      occurrences.set(base, n)
      slug = `${base}-${n}`
    }
    occurrences.set(slug, 0)
    slugs.add(slug)
  })
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
      if (t.type === 'text') return decodeEntities(t.text)
      return 'text' in t && typeof t.text === 'string' ? t.text : ''
    })
    .join('')
}

// marked decodes numeric references in text but leaves named ones; a code span keeps both.
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

function decodeEntities(text: string): string {
  return text.replace(
    /&([a-z]+);/gi,
    (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole,
  )
}

function splitFrontmatter(text: string): { data: string | null; body: string } {
  if (!text.startsWith('---\n')) return { data: null, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1 || !/^\n---(\n|$)/.test(text.slice(end, end + 5))) {
    return { data: null, body: text }
  }
  return { data: text.slice(4, end + 1), body: text.slice(end + 4) }
}

function stripFrontmatter(text: string): string {
  return splitFrontmatter(text).body
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
  let base = 'origin/master'
  const flags: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base') base = args[++i] ?? ''
    else if (args[i].startsWith('--base=')) base = args[i].slice('--base='.length)
    else flags.push(args[i])
  }
  if (!base || base.startsWith('-')) {
    console.error('docs-check: --base needs a ref, such as --base origin/master')
    process.exit(2)
  }
  const unknown = flags.find((a) => a !== '--write' && a !== '--strict')
  if (unknown) {
    console.error(`docs-check: unknown argument ${unknown}; use --write, --strict and --base <ref>`)
    process.exit(2)
  }
  const root = path.resolve(import.meta.dirname, '..')
  const result = docsCheck(root, {
    write: flags.includes('--write'),
    strict: flags.includes('--strict'),
    base,
  })
  for (const file of result.written) console.log(`docs-check: wrote ${file}`)
  for (const file of result.removed) console.log(`docs-check: removed ${file}`)
  for (const error of result.errors) console.error(`error: ${error}`)
  for (const warning of [...result.warnings, ...result.notices])
    console.error(`warning: ${warning}`)
  if (result.ok) console.log('docs-check: ok')
  else process.exitCode = 1
}
