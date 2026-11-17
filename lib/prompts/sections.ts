import {
  Tag,
  type Context,
  type Emitter,
  type Liquid,
  type Parser,
  type TagToken,
  type Template,
  type TopLevelToken,
} from 'liquidjs'

import { logger } from '@/lib/diagnostics'

import { PROMPT_SECTION_IDS, type HalfSections, type PromptSectionId } from './types'

/** The render-time `globals` key the collector rides: a Symbol, so no template can name or read it. */
export const SECTIONS = Symbol('aventuras.prompt-sections')

// A section's own text and the texts of the sections nested in it; `id` null is an unknown id.
type SectionRecord = { id: PromptSectionId | null; text: string }
type ClosedSection = { output: string; records: SectionRecord[] }

// `output` less each nested section's output, found in order from where the last one ended. A nested
// output that isn't there never reached the prompt (a discarded capture), so its records go with it.
function withoutNested(
  output: string,
  nested: readonly ClosedSection[],
): { own: string; kept: SectionRecord[] } {
  const pieces: string[] = []
  const kept: SectionRecord[] = []
  let cursor = 0
  for (const section of nested) {
    const at = output.indexOf(section.output, cursor)
    if (at < 0) continue
    pieces.push(output.slice(cursor, at))
    cursor = at + section.output.length
    kept.push(...section.records)
  }
  pieces.push(output.slice(cursor))
  return { own: pieces.join(''), kept }
}

/** One half's sections as rendered; one collector per render, never shared. */
export class SectionCollector {
  // The root frame holds the top-level sections; each open section pushes a frame of its own.
  private readonly frames: ClosedSection[][] = [[]]

  open(): void {
    this.frames.push([])
  }

  close(id: PromptSectionId | null, output: string): void {
    const nested = this.frames.pop() ?? []
    const { own, kept } = withoutNested(output, nested)
    this.frames.at(-1)?.push({ output, records: [{ id, text: own }, ...kept] })
  }

  /** Every byte of `full` lands in exactly one piece: a named section's own text, or `unnamed`. */
  finish(full: string): HalfSections {
    const { own: outside, kept } = withoutNested(full, this.frames[0] ?? [])
    const named: { id: PromptSectionId; text: string }[] = []
    const unnamed: string[] = outside === '' ? [] : [outside]
    for (const record of kept) {
      if (record.text === '') continue
      if (record.id === null) unnamed.push(record.text)
      else named.push({ id: record.id, text: record.text })
    }
    return { named, unnamed }
  }
}

function collectorOf(ctx: Context): SectionCollector | undefined {
  const found = (ctx.globals as Record<symbol, unknown> | undefined)?.[SECTIONS]
  return found instanceof SectionCollector ? found : undefined
}

function isSectionId(id: string): id is PromptSectionId {
  return (PROMPT_SECTION_IDS as readonly string[]).includes(id)
}

const warnedIds = new Set<string>()

/** Test seam: forgets which unknown ids have warned. */
export function __resetSectionWarnings(): void {
  warnedIds.clear()
}

/**
 * `{% section 'id' %}…{% endsection %}` (architecture.md → Prompt sections): writes its body through
 * unchanged, pushes no scope, and exposes its body to static analysis through `children()`, so a
 * variable read only inside a section still counts as read.
 */
export class SectionTag extends Tag {
  private readonly id: PromptSectionId | null
  private readonly templates: Template[] = []

  constructor(token: TagToken, remainTokens: TopLevelToken[], liquid: Liquid, parser: Parser) {
    super(token, remainTokens, liquid)
    const quoted = this.tokenizer.readQuoted()
    if (quoted === undefined) throw this.tokenizer.error('section expects a quoted id')
    this.tokenizer.skipBlank()
    this.tokenizer.assert(this.tokenizer.end(), 'section takes only its quoted id')
    const id = quoted.content
    this.id = isSectionId(id) ? id : null
    if (this.id === null && !warnedIds.has(id)) {
      warnedIds.add(id)
      logger.warn('provider.prompt_section_unknown', { id })
    }
    const stream = parser
      .parseStream(remainTokens)
      .on('tag:endsection', () => {
        stream.stop()
      })
      .on('template', (template: Template) => {
        this.templates.push(template)
      })
      .on('end', () => {
        throw new Error(`tag ${token.getText()} not closed`)
      })
    stream.start()
  }

  // Parsed tags are shared across renders (the engine caches parses), so the collector is read from
  // this render's context, never kept on the tag.
  *render(ctx: Context, emitter: Emitter): Generator<unknown, void, unknown> {
    const collector = collectorOf(ctx)
    collector?.open()
    let output = ''
    try {
      output = (yield this.liquid.renderer.renderTemplates(this.templates, ctx)) as string
    } finally {
      collector?.close(this.id, output)
    }
    emitter.write(output)
  }

  *children(): Generator<unknown, Template[]> {
    return this.templates
  }
}
