import type { PromptSections } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { PROMPT_SECTION_IDS, type HalfSections, type PromptSectionId } from '@/lib/prompts'

import { countPromptText, countWithStoredProse } from './context-window'

type Halves = { readonly system: HalfSections; readonly user: HalfSections }

/** A render split by section (architecture.md → Prompt sections), for the call that sends it. */
export type PromptSectionsInput = {
  readonly halves: Halves
  /**
   * Prices the user half's `history` from stored counts: the same template rendered with every
   * entry's prose blank, the entries' prose length and stored counts summed, and the ms that
   * render took, for the measure's log.
   */
  readonly history?: {
    readonly blank: Halves
    readonly prose: { readonly chars: number; readonly tokens: number }
    readonly renderMs: number
  }
}

export type CountedSections = {
  readonly named: Partial<Record<PromptSectionId, number>>
  /** Every piece of the user half counted, named or not: the count primed for the text sent. */
  readonly userTokens: number
}

const joinedHistory = (half: HalfSections): string =>
  half.named
    .filter(({ id }) => id === 'history')
    .map(({ text }) => text)
    .join('')

/**
 * Counts each section through the count cache, so one unchanged since the last call costs nothing,
 * and the user half's `history` from stored counts when it is priced. `contract` holds the texts the
 * call layer adds to the request, counted under `output` and never into the user half.
 */
export function countSections(
  input: PromptSectionsInput,
  opts: {
    contract?: readonly string[]
    providerId: string
    modelId: string
    actionId?: string
  },
): CountedSections {
  const startedAt = performance.now()
  const named: Partial<Record<PromptSectionId, number>> = {}
  const add = (id: PromptSectionId, tokens: number): void => {
    named[id] = (named[id] ?? 0) + tokens
  }
  const { history } = input
  // Priced only when the history sits in the user half alone: the prose sum covers one text.
  const pricesHistory =
    history !== undefined && !input.halves.system.named.some(({ id }) => id === 'history')

  let userTokens = 0
  for (const half of ['system', 'user'] as const) {
    const sections = input.halves[half]
    let halfTokens = 0
    for (const { id, text } of sections.named) {
      if (pricesHistory && half === 'user' && id === 'history') continue
      const tokens = countPromptText(text)
      add(id, tokens)
      halfTokens += tokens
    }
    for (const text of sections.unnamed) halfTokens += countPromptText(text)
    if (half === 'user') userTokens = halfTokens
  }
  if (pricesHistory) {
    const text = joinedHistory(input.halves.user)
    if (text !== '') {
      // Not recorded: the history changes every turn, and the check counts the whole user half.
      const tokens = countWithStoredProse(text, joinedHistory(history.blank.user), history.prose, {
        record: false,
      })
      add('history', tokens)
      userTokens += tokens
    }
  }
  for (const text of opts.contract ?? []) add('output', countPromptText(text))

  logger.debug(
    'provider.prompt_sections',
    {
      providerId: opts.providerId,
      modelId: opts.modelId,
      ms: Math.round(performance.now() - startedAt),
      ...(history !== undefined ? { renderMs: Math.round(history.renderMs) } : {}),
    },
    opts.actionId === undefined ? undefined : { actionId: opts.actionId },
  )
  return { named, userTokens }
}

/**
 * The named sections in vocabulary order plus `other`, the call's estimate less every named section,
 * floored at zero; a zero section is left out (data-model.md → Entry metadata shape).
 */
export function promptSectionsOf(counted: CountedSections, estimate: number): PromptSections {
  const sections: PromptSections = {}
  let named = 0
  for (const id of PROMPT_SECTION_IDS) {
    const tokens = counted.named[id] ?? 0
    if (tokens <= 0) continue
    sections[id] = tokens
    named += tokens
  }
  const other = Math.max(0, estimate - named)
  if (other > 0) sections.other = other
  return sections
}
