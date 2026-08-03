/**
 * Prompt Block Joining
 *
 * Sticking two independently-built prompt blocks together without either running into the
 * other or drifting apart.
 *
 * The narrator prompt is assembled from blocks written by different services, and they do
 * not agree on whether a block owns the blank line in front of it. `WorldStateInjector` and
 * `EntryRetrievalService` both open theirs with `\n\n`; `AgenticRetrievalService` returns
 * `[Retrieved Context - ...]` with nothing in front. Concatenating them raw therefore
 * depended on which retrieval mode was active, and in agentic mode produced this in a real
 * turn:
 *
 *     ...She is now his devoted pet.[Retrieved Context - I searched for all mentions...
 *
 * while the static path, where two `\n\n`-prefixed blocks meet a `join('\n')`, produced
 * three blank lines instead.
 *
 * Normalising the boundary rather than prefixing a fixed separator is what keeps the
 * already-correct case byte-identical -- which matters more here than it looks, since the
 * blocks in front of these are the reusable prefix of the request (see the prompt-ordering
 * note in the README), and a gratuitous byte change at the seam is a byte change in every
 * turn's prompt.
 *
 * Pure and dependency-free, so the boundary rules are testable without a prompt engine.
 */

/** Blank line between blocks: one empty line, so two newlines. */
const SEPARATOR_NEWLINES = 2

function trailingNewlines(text: string): number {
  let n = 0
  while (n < text.length && text[text.length - 1 - n] === '\n') n++
  return n
}

function leadingNewlines(text: string): number {
  let n = 0
  while (n < text.length && text[n] === '\n') n++
  return n
}

/**
 * Join prompt blocks with exactly one blank line between each pair, ignoring empty ones.
 *
 * Newlines already at a boundary count toward the separator, so a block that brings its own
 * leading `\n\n` is passed through untouched. Blocks are never trimmed: trailing whitespace
 * inside a block is the block's business, and only the *count* of newlines at the join is
 * adjusted -- upward when there are too few, downward when there are too many.
 *
 * Returns `''` when nothing survives, which is what the narrative template's
 * `{% if tieredContextBlock != '' %}` guard expects.
 */
export function joinPromptBlocks(...blocks: (string | null | undefined)[]): string {
  const present = blocks.filter((b): b is string => !!b && b.length > 0)
  if (present.length === 0) return ''

  let out = present[0]

  for (const block of present.slice(1)) {
    const trailing = trailingNewlines(out)
    const leading = leadingNewlines(block)
    const have = trailing + leading

    if (have === SEPARATOR_NEWLINES) {
      out += block
      continue
    }

    if (have < SEPARATOR_NEWLINES) {
      out += '\n'.repeat(SEPARATOR_NEWLINES - have) + block
      continue
    }

    // Too many. Take them off the newer block first and only then off the accumulated
    // text, so a block that deliberately ends in blank lines keeps them when it can.
    const dropFromBlock = Math.min(leading, have - SEPARATOR_NEWLINES)
    const dropFromOut = have - SEPARATOR_NEWLINES - dropFromBlock
    out = out.slice(0, out.length - dropFromOut) + block.slice(dropFromBlock)
  }

  return out
}
