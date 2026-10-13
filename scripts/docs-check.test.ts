import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENTS_BLOCK_MAX_LINES, docsCheck, slugify } from './docs-check.ts'

const TAGS = 'persistence: Database schema, storage, and migrations\ncache: Caching strategy\n'
const AGENTS =
  '# Agents\n\nHand-written.\n\n<!-- BEGIN GENERATED: decisions -->\n<!-- END GENERATED: decisions -->\n'
const BODY = `# Title

## Context and Problem Statement

Why.

## Considered Options

* A
* B

## Decision Outcome

Chosen option: "A", because reasons.

### Consequences

* Good, because x
* Bad, because y
`

function adr(frontmatter: string, body = BODY): string {
  return `---\n${frontmatter}\n---\n\n${body}`
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A git repo holding a minimal valid system plus `files`; `null` leaves a default out. */
function repo(files: Record<string, string | null>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-check-'))
  roots.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  const all: Record<string, string | null> = {
    'docs/decision-tags.yml': TAGS,
    'docs/ARCHITECTURE.md': '# Architecture\n',
    'docs/adr-template.md': '# Template\n',
    'AGENTS.md': AGENTS,
    ...files,
  }
  for (const [file, content] of Object.entries(all)) {
    if (content === null) continue
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  return root
}

const read = (root: string, file: string) => readFileSync(path.join(root, file), 'utf8')

/** Generates the outputs, then validates as the hook does. */
function check(root: string, strict = false) {
  docsCheck(root, { write: true })
  return docsCheck(root, { strict })
}

function errorsFor(files: Record<string, string | null>): string[] {
  return check(repo(files)).errors
}

describe('a valid set', () => {
  it('passes and renders the index grouped by tag, in vocabulary order', () => {
    const root = repo({
      'docs/decisions/2026-01-02-cache-keys.md': adr(
        'summary: Generate our own cache keys.\ntags: [cache, persistence]\ncross-cutting: true',
      ),
      'docs/decisions/sub/2026-01-01-wal-mode.md': adr(
        'summary: Run SQLite in WAL mode.\ntags: [persistence]',
      ),
      'docs/decisions/2026-01-03-plain-rule.md': adr('summary: Keep it plain.'),
    })
    const result = check(root)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)

    const readme = read(root, 'docs/README.md')
    const persistence = readme.indexOf('## persistence: Database schema')
    const cache = readme.indexOf('## cache: Caching strategy')
    const general = readme.indexOf('## General')
    expect(persistence).toBeGreaterThan(-1)
    expect(cache).toBeGreaterThan(persistence)
    expect(general).toBeGreaterThan(cache)
    const persistenceSection = readme.slice(persistence, cache)
    expect(persistenceSection.indexOf('wal-mode')).toBeLessThan(
      persistenceSection.indexOf('cache-keys'),
    )
    expect(readme.slice(cache, general)).toContain(
      '- Generate our own cache keys. [cache-keys](decisions/2026-01-02-cache-keys.md)',
    )
    expect(readme.slice(general)).toContain('plain-rule')

    const agents = read(root, 'AGENTS.md')
    expect(agents).toContain('Hand-written.')
    expect(agents).toContain(
      '- Generate our own cache keys. [cache-keys](docs/decisions/2026-01-02-cache-keys.md)',
    )
    expect(agents).not.toContain('wal-mode')
  })

  it('writes byte-identical output on a second run', () => {
    const root = repo({ 'docs/decisions/2026-01-01-a.md': adr('summary: A.\ncross-cutting: true') })
    docsCheck(root, { write: true })
    const readme = read(root, 'docs/README.md')
    const agents = read(root, 'AGENTS.md')
    expect(docsCheck(root, { write: true }).written).toEqual([])
    expect(read(root, 'docs/README.md')).toBe(readme)
    expect(read(root, 'AGENTS.md')).toBe(agents)
    expect(readme).not.toContain('\r')
  })
})

describe('filenames and slugs', () => {
  it('rejects a name without a date or with an uppercase slug', () => {
    expect(errorsFor({ 'docs/decisions/cache.md': adr('summary: A.') })).toEqual([
      expect.stringContaining('name it YYYY-MM-DD-slug.md'),
    ])
    expect(errorsFor({ 'docs/decisions/2026-01-01-Cache.md': adr('summary: A.') })).toEqual([
      expect.stringContaining('name it YYYY-MM-DD-slug.md'),
    ])
  })

  it('rejects a date that does not exist', () => {
    expect(errorsFor({ 'docs/decisions/2026-02-30-a.md': adr('summary: A.') })).toEqual([
      expect.stringContaining('2026-02-30 is not a real date'),
    ])
  })

  it('rejects a slug used twice, across subdirectories and dates', () => {
    const errors = errorsFor({
      'docs/decisions/2026-01-01-a.md': adr('summary: A.'),
      'docs/decisions/old/2025-01-01-a.md': adr('summary: Older A.'),
    })
    expect(errors).toEqual([expect.stringContaining('slug "a" is already used by')])
  })
})

describe('frontmatter', () => {
  const file = 'docs/decisions/2026-01-01-a.md'

  it.each([
    ['tags: [cache]', 'summary is required'],
    ['summary: "   "', 'summary is required'],
    [`summary: ${'x'.repeat(201)}`, 'summary is 201 characters'],
    ['summary: A.\nstatus: accepted', 'unknown frontmatter key "status"'],
    ['summary: A.\ntags: cache', 'tags must be a list of strings'],
    ['summary: A.\ntags: [nope]', 'tag "nope" is not in docs/decision-tags.yml'],
    ['summary: A.\ncross-cutting: yes please', 'cross-cutting must be true or false'],
    ['summary: A.\nactive: "true"', 'active must be true or false'],
    ['summary: A.\nsuperseded-by: 2026-01-02-b.md', 'superseded-by must be the slug'],
  ])('%j fails with "%s"', (frontmatter, message) => {
    expect(errorsFor({ [file]: adr(frontmatter) })).toEqual([expect.stringContaining(message)])
  })

  it('requires frontmatter', () => {
    expect(errorsFor({ [file]: BODY })).toContain(
      `${file}: missing frontmatter; copy it from docs/adr-template.md`,
    )
  })

  it('accepts a summary of exactly the limit', () => {
    expect(errorsFor({ [file]: adr(`summary: ${'x'.repeat(200)}`) })).toEqual([])
  })
})

describe('body', () => {
  const file = 'docs/decisions/2026-01-01-a.md'

  it('requires every MADR heading', () => {
    const errors = errorsFor({
      [file]: adr('summary: A.', BODY.replace('## Considered Options', '## Options')),
    })
    expect(errors).toEqual([expect.stringContaining('missing the "Considered Options" heading')])
  })

  it('requires an accepted downside under Consequences', () => {
    const errors = errorsFor({
      [file]: adr('summary: A.', BODY.replace('* Bad, because y', '* Neutral')),
    })
    expect(errors).toEqual([expect.stringContaining('Consequences needs a "* Bad, because')])
  })

  it('does not count a Bad line from a later section', () => {
    const body = `${BODY.replace('* Bad, because y', '')}\n## More Information\n\n* Bad, because z\n`
    expect(errorsFor({ [file]: adr('summary: A.', body) })).toEqual([
      expect.stringContaining('Consequences needs'),
    ])
  })
})

describe('deprecation and supersession', () => {
  it('lists a deprecated ADR with its successor and keeps it out of AGENTS.md', () => {
    const root = repo({
      'docs/decisions/2026-01-01-old.md': adr(
        'summary: Old way.\nactive: true\nsuperseded-by: new\ncross-cutting: true',
      ),
      'docs/decisions/2026-02-01-new.md': adr('summary: New way.\ncross-cutting: true'),
    })
    expect(check(root).errors).toEqual([])
    expect(read(root, 'docs/README.md')).toContain(
      '- **Deprecated → [new](decisions/2026-02-01-new.md).** Old way. [old](decisions/2026-01-01-old.md)',
    )
    expect(read(root, 'AGENTS.md')).not.toContain('Old way.')
  })

  it('rejects a deprecated ADR whose successor is not active', () => {
    const errors = errorsFor({
      'docs/decisions/2026-01-01-a.md': adr('summary: A.\nactive: true\nsuperseded-by: b'),
      'docs/decisions/2026-02-01-b.md': adr('summary: B.\nsuperseded-by: c'),
      'docs/decisions/2026-03-01-c.md': adr('summary: C.'),
    })
    expect(errors).toEqual([expect.stringContaining('its successor b is superseded')])
  })

  it('follows a supersession chain to a retired terminal and lists none of it', () => {
    const root = repo({
      'docs/decisions/2026-01-01-a.md': adr('summary: A.\nsuperseded-by: b'),
      'docs/decisions/2026-02-01-b.md': adr('summary: B.\nsuperseded-by: c'),
      'docs/decisions/2026-03-01-c.md': adr('summary: C.\nactive: false'),
    })
    expect(check(root).errors).toEqual([])
    expect(read(root, 'docs/README.md')).toContain('No decisions recorded yet.')
  })

  it('defaults active to false when superseded-by is set', () => {
    const root = repo({
      'docs/decisions/2026-01-01-a.md': adr('summary: A.\nsuperseded-by: b'),
      'docs/decisions/2026-02-01-b.md': adr('summary: B.'),
    })
    check(root)
    expect(read(root, 'docs/README.md')).not.toContain('[a]')
  })

  it('rejects a successor that does not exist', () => {
    expect(
      errorsFor({ 'docs/decisions/2026-01-01-a.md': adr('summary: A.\nsuperseded-by: gone') }),
    ).toEqual([expect.stringContaining('superseded-by names "gone", which no ADR has')])
  })

  it('rejects a cycle', () => {
    const errors = errorsFor({
      'docs/decisions/2026-01-01-a.md': adr('summary: A.\nsuperseded-by: b'),
      'docs/decisions/2026-02-01-b.md': adr('summary: B.\nsuperseded-by: a'),
    })
    expect(errors).toContain(
      'docs/decisions/2026-01-01-a.md: superseded-by loops (a → b → a); break the cycle',
    )
  })
})

describe('code anchors', () => {
  const decisions = {
    'docs/decisions/2026-01-01-live.md': adr('summary: Live.'),
    'docs/decisions/2026-01-02-fading.md': adr(
      'summary: Fading.\nactive: true\nsuperseded-by: live',
    ),
    'docs/decisions/2026-01-03-gone.md': adr('summary: Gone.\nsuperseded-by: live'),
    'docs/decisions/2026-01-04-dropped.md': adr('summary: Dropped.\nactive: false'),
  }

  it('accepts anchors to active and deprecated ADRs', () => {
    const source = '// DECISION(live): why\n/* DECISION(fading) */\n'
    expect(errorsFor({ ...decisions, 'src/a.ts': source })).toEqual([])
  })

  it('rejects anchors to superseded, retired and missing ADRs, with the line', () => {
    const source = '// DECISION(gone)\n# DECISION(dropped)\n<!-- DECISION(nothing) -->\n'
    expect(errorsFor({ ...decisions, 'src/a.svelte': source })).toEqual([
      'src/a.svelte:1: DECISION(gone) names a superseded ADR; bring the code in line with live and update the anchor',
      'src/a.svelte:2: DECISION(dropped) names a retired ADR; remove the anchor',
      'src/a.svelte:3: DECISION(nothing) names no ADR; fix the slug or write the ADR',
    ])
  })

  it('ignores Markdown, docs/, binaries and ignored files', () => {
    expect(
      errorsFor({
        'notes.md': 'Write `DECISION(slug)` in a comment.\n',
        'docs/evidence/x.ts': '// DECISION(nothing)\n',
        'docs/decisions/2026-01-01-a.md': adr('summary: A.\n', `${BODY}\n[x](../evidence/x.ts)\n`),
        'bin.dat': 'DECISION(nothing)\0',
        '.gitignore': 'ignored.ts\n',
        'ignored.ts': '// DECISION(nothing)\n',
      }),
    ).toEqual([])
  })
})

describe('doc paths in source', () => {
  it('rejects a doc path that does not exist, or a fragment it lacks', () => {
    const errors = errorsFor({
      'docs/guide.md': '# Guide\n\n## Caching\n',
      'docs/decisions/2026-01-01-a.md': adr('summary: A.', `${BODY}\n[g](../guide.md)\n`),
      'src/a.ts': [
        '// See docs/guide.md and docs/guide.md#caching.',
        '// See docs/gone.md.',
        '// See docs/guide.md#nope',
        "const url = 'https://example.com/docs/elsewhere.md'",
      ].join('\n'),
    })
    expect(errors).toEqual([
      'src/a.ts:2: docs/gone.md does not exist; point it at the current doc or ADR',
      'src/a.ts:3: docs/guide.md#nope: docs/guide.md has no heading or anchor "#nope"; point it at the current doc or ADR',
    ])
  })
})

describe('links', () => {
  it('checks paths and fragments in every Markdown file, skipping code and URLs', () => {
    const errors = errorsFor({
      'README.md': '[ok](docs/ARCHITECTURE.md#architecture) [bad](docs/missing.md)\n',
      'docs/ARCHITECTURE.md': [
        '# Architecture',
        '',
        '## The `#lib` import',
        '',
        '[self](#the-lib-import) [dir](../docs/) [up](../README.md) [web](https://x.y/z.md)',
        '[frag](#no-such) `[code](nope.md)`',
        '',
        '```',
        '[fenced](nope.md)',
        '```',
      ].join('\n'),
    })
    expect(errors).toEqual([
      'README.md: docs/missing.md does not exist',
      'docs/ARCHITECTURE.md: #no-such: docs/ARCHITECTURE.md has no heading or anchor "#no-such"',
    ])
  })

  it('rejects a link out of the repository', () => {
    expect(errorsFor({ 'docs/ARCHITECTURE.md': '[x](../../elsewhere.md)\n' })).toEqual([
      'docs/ARCHITECTURE.md: ../../elsewhere.md points outside the repository',
    ])
  })
})

describe('evidence', () => {
  it('warns about an orphan, which fails only under --strict', () => {
    const root = repo({ 'docs/evidence/run.log': 'data\n' })
    const result = check(root)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([
      expect.stringContaining('docs/evidence/run.log: no ADR links'),
    ])
    expect(result.ok).toBe(true)
    expect(check(root, true).ok).toBe(false)
  })

  it('counts a link from an ADR in any state, and a folder link for everything under it', () => {
    const root = repo({
      'docs/decisions/2026-01-01-a.md': adr(
        'summary: A.\nactive: false',
        `${BODY}\n[run](../evidence/run.log) [study](../evidence/study/)\n`,
      ),
      'docs/evidence/run.log': 'data\n',
      'docs/evidence/study/notes.md': '# Notes\n',
      'docs/evidence/study/deep/data.csv': 'a,b\n',
    })
    expect(check(root, true)).toMatchObject({ ok: true, errors: [], warnings: [] })
  })

  it('does not count a link from outside the decisions', () => {
    const root = repo({
      'docs/ARCHITECTURE.md': '[run](evidence/run.log)\n',
      'docs/evidence/run.log': 'data\n',
    })
    expect(check(root).warnings).toHaveLength(1)
  })

  it('does not count a link to docs/evidence/ itself, or to anything above it', () => {
    const root = repo({
      'docs/decisions/2026-01-01-a.md': adr(
        'summary: A.',
        `${BODY}\n[all](../evidence/) [docs](../) [root](../../)\n`,
      ),
      'docs/evidence/run.log': 'data\n',
      'docs/evidence/study/data.csv': 'a,b\n',
    })
    expect(check(root).warnings).toEqual([
      expect.stringContaining('docs/evidence/run.log: no ADR links'),
      expect.stringContaining('docs/evidence/study/data.csv: no ADR links'),
    ])
  })
})

describe('generated outputs', () => {
  it('rejects a hand-edited index or block', () => {
    const root = repo({ 'docs/decisions/2026-01-01-a.md': adr('summary: A.\ncross-cutting: true') })
    docsCheck(root, { write: true })
    writeFileSync(path.join(root, 'docs/README.md'), `${read(root, 'docs/README.md')}extra\n`)
    writeFileSync(path.join(root, 'AGENTS.md'), read(root, 'AGENTS.md').replace('- A.', '- B.'))
    expect(docsCheck(root).errors).toEqual([
      'docs/README.md is stale or was edited by hand; run `npm run docs:gen` and commit the result',
      'AGENTS.md is stale or was edited by hand; run `npm run docs:gen` and commit the result',
    ])
  })

  it('reports a missing index in check mode', () => {
    expect(docsCheck(repo({})).errors).toContain(
      'docs/README.md is stale or was edited by hand; run `npm run docs:gen` and commit the result',
    )
  })

  it.each([
    ['missing', '# Agents\n'],
    ['duplicated', `${AGENTS}${AGENTS}`],
    ['reversed', '<!-- END GENERATED: decisions -->\n<!-- BEGIN GENERATED: decisions -->\n'],
  ])('rejects %s markers', (_, agents) => {
    expect(errorsFor({ 'AGENTS.md': agents })).toEqual([
      expect.stringContaining(
        'AGENTS.md: needs exactly one <!-- BEGIN GENERATED: decisions --> line',
      ),
    ])
  })

  it('rejects a missing AGENTS.md', () => {
    expect(errorsFor({ 'AGENTS.md': null })).toEqual([
      expect.stringContaining('AGENTS.md is missing'),
    ])
  })

  it('rejects a block over the line budget', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < AGENTS_BLOCK_MAX_LINES; i++) {
      files[`docs/decisions/2026-01-01-rule-${i}.md`] = adr(
        `summary: Rule ${i}.\ncross-cutting: true`,
      )
    }
    expect(errorsFor(files)).toEqual([
      expect.stringContaining(`over the budget of ${AGENTS_BLOCK_MAX_LINES}`),
    ])
  })
})

describe('slugify', () => {
  it('matches GitHub heading anchors', () => {
    expect(slugify('Importing `src/lib`')).toBe('importing-srclib')
    expect(slugify('The a<b & x bold')).toBe('the-ab--x-bold')
    expect(slugify('What the helpers do not do (yet)')).toBe('what-the-helpers-do-not-do-yet')
    expect(slugify('snake_case stays')).toBe('snake_case-stays')
  })
})
