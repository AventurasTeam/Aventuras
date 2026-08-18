#!/usr/bin/env node
// Enumerates comment blocks touched by a commit range and packs the owning
// files into subagent-sized batches. Files are never split across batches:
// judging a comment needs the whole file.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const argv = process.argv.slice(2)
const batchFlag = argv.indexOf('--batch')
const WANT_BATCH = batchFlag === -1 ? null : Number(argv[batchFlag + 1])
const positional = argv.filter((a, i) => !a.startsWith('--') && !(batchFlag !== -1 && i === batchFlag + 1))
const RANGE = positional[0] ?? 'origin/main...HEAD'
const BLOCK_BUDGET = Number(process.env.BLOCK_BUDGET ?? 60)
const LINE_BUDGET = Number(process.env.LINE_BUDGET ?? 2500)
const MIN_BLOCK = Number(process.env.MIN_BLOCK ?? 2)

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 })

// Pathspecs below are repo-relative; without this the script silently finds
// nothing when invoked from a subdirectory.
process.chdir(git('rev-parse', '--show-toplevel').trim())

const files = git('diff', '--name-only', '--diff-filter=d', RANGE, '--', '*.ts', '*.tsx', '*.js', '*.jsx')
  .split('\n')
  .filter((f) => f && existsSync(f))

// New-file line ranges the range actually added or modified. Comments outside
// these are pre-existing and out of scope.
function addedRanges(file) {
  const diff = git('diff', '-U0', RANGE, '--', file)
  const ranges = []
  for (const line of diff.split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!m) continue
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    if (count > 0) ranges.push([start, start + count - 1])
  }
  return ranges
}

// Consecutive comment-only lines form one block. Deliberately loose — this is a
// candidate finder, the subagent adjudicates.
function commentBlocks(src) {
  const lines = src.split('\n')
  const blocks = []
  let start = null
  let inBlockComment = false

  lines.forEach((raw, i) => {
    const t = raw.trim()
    let isComment = false
    if (inBlockComment) {
      isComment = true
      if (t.includes('*/')) inBlockComment = false
    } else if (t.startsWith('/*')) {
      isComment = true
      if (!t.includes('*/')) inBlockComment = true
    } else if (t.startsWith('//') || t.startsWith('*')) {
      isComment = true
    }

    if (isComment) {
      if (start === null) start = i + 1
    } else if (start !== null) {
      blocks.push({ start, end: i, lines: i - start + 1 })
      start = null
    }
  })
  if (start !== null) blocks.push({ start, end: lines.length, lines: lines.length - start + 1 })
  return blocks
}

const overlaps = (a, b, ranges) => ranges.some(([s, e]) => a <= e && b >= s)

const entries = []
for (const path of files) {
  const src = readFileSync(path, 'utf8')
  const ranges = addedRanges(path)
  if (!ranges.length) continue
  const blocks = commentBlocks(src).filter((b) => b.lines >= MIN_BLOCK && overlaps(b.start, b.end, ranges))
  if (!blocks.length) continue
  entries.push({
    path,
    sourceLines: src.split('\n').length,
    addedRanges: ranges,
    blocks,
    blockCount: blocks.length,
    commentLines: blocks.reduce((n, b) => n + b.lines, 0),
  })
}

// Heaviest first so an oversized file lands alone rather than dragging a batch over budget.
entries.sort((a, b) => b.blockCount - a.blockCount)

const batches = []
for (const e of entries) {
  let target = batches.find(
    (b) => b.blocks + e.blockCount <= BLOCK_BUDGET && b.sourceLines + e.sourceLines <= LINE_BUDGET,
  )
  if (!target) {
    target = { id: batches.length + 1, files: [], blocks: 0, sourceLines: 0, commentLines: 0 }
    batches.push(target)
  }
  target.files.push(e)
  target.blocks += e.blockCount
  target.sourceLines += e.sourceLines
  target.commentLines += e.commentLines
}

const fmt = (rs) => rs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')

if (WANT_BATCH !== null) {
  const b = batches.find((x) => x.id === WANT_BATCH)
  if (!b) {
    console.error(`No batch ${WANT_BATCH} (have 1..${batches.length})`)
    process.exit(1)
  }
  console.log(`Batch ${b.id}/${batches.length} — ${b.files.length} files, ${b.blocks} candidate blocks, range ${RANGE}\n`)
  for (const f of b.files) {
    console.log(`${f.path}  (${f.sourceLines} lines)`)
    console.log(`  in-range lines: ${fmt(f.addedRanges)}`)
    console.log(`  candidate blocks: ${f.blocks.map((x) => `${x.start}-${x.end}(${x.lines}L)`).join(' ')}\n`)
  }
  process.exit(0)
}

console.log(
  JSON.stringify(
    {
      range: RANGE,
      totals: {
        filesChanged: files.length,
        filesWithCandidates: entries.length,
        candidateBlocks: entries.reduce((n, e) => n + e.blockCount, 0),
        candidateCommentLines: entries.reduce((n, e) => n + e.commentLines, 0),
        batches: batches.length,
      },
      batches: batches.map((b) => ({
        id: b.id,
        blocks: b.blocks,
        sourceLines: b.sourceLines,
        files: b.files.map((f) => ({
          path: f.path,
          sourceLines: f.sourceLines,
          inRangeLines: fmt(f.addedRanges),
          blocks: f.blocks.map((x) => `${x.start}-${x.end}(${x.lines}L)`),
        })),
      })),
    },
    null,
    2,
  ),
)
