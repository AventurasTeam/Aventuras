import type { EntryIndex } from '@/lib/entry-refs'

export const PLOT_KINDS = ['thread', 'happening'] as const
export type PlotKind = (typeof PLOT_KINDS)[number]

export function isPlotKind(value: unknown): value is PlotKind {
  return typeof value === 'string' && (PLOT_KINDS as readonly string[]).includes(value)
}

/**
 * What both Plot modules read beyond their rows: the entry index (positions, chapter ids)
 * and whether any chapter has closed, which decides if `This chapter` is offered.
 */
export type PlotListSignals = { entries: EntryIndex; hasClosedChapters: boolean }
