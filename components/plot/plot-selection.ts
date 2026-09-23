import { single } from '@/components/world/world-selection'
import { t } from '@/lib/i18n'
import { isPlotKind, type PlotKind } from '@/lib/list-modules'

type RawParam = string | string[] | undefined

export const THREAD_TABS = ['overview', 'history'] as const
export const HAPPENING_TABS = ['overview', 'involvements', 'awareness', 'history'] as const
export type ThreadTab = (typeof THREAD_TABS)[number]
export type HappeningTab = (typeof HAPPENING_TABS)[number]

export type PlotSelection =
  | { kind: 'thread'; id: string; tab?: ThreadTab }
  | { kind: 'happening'; id: string; tab?: HappeningTab }

function tabOf<Tab extends string>(tabs: readonly Tab[], value: string | undefined) {
  return tabs.find((tab) => tab === value)
}

/**
 * `/plot/[branchId]?kind&id&tab` — mirrors World's param names (parseWorldSelection). A tab the
 * kind doesn't have is dropped, so the pane opens on Overview.
 */
export function parsePlotSelection(params: {
  kind?: RawParam
  id?: RawParam
  tab?: RawParam
}): PlotSelection | null {
  const kind = single(params.kind)
  const id = single(params.id)
  if (!isPlotKind(kind) || id == null) return null
  const raw = single(params.tab)
  if (kind === 'thread') {
    const tab = tabOf(THREAD_TABS, raw)
    return tab == null ? { kind, id } : { kind, id, tab }
  }
  const tab = tabOf(HAPPENING_TABS, raw)
  return tab == null ? { kind, id } : { kind, id, tab }
}

/** A deep link's tab, for its own row only. */
export function threadLinkTab(link: PlotSelection | null, id: string): ThreadTab | undefined {
  return link?.kind === 'thread' && link.id === id ? link.tab : undefined
}

export function happeningLinkTab(link: PlotSelection | null, id: string): HappeningTab | undefined {
  return link?.kind === 'happening' && link.id === id ? link.tab : undefined
}

export function plotKindLabel(kind: PlotKind): string {
  return t(`plot:kinds.${kind}`)
}

export function plotAddLabel(kind: PlotKind): string {
  return t(`plot:add.${kind}`)
}
