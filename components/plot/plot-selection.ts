import { single } from '@/components/world/world-selection'
import { t } from '@/lib/i18n'
import { isPlotKind, type PlotKind } from '@/lib/list-modules'

type RawParam = string | string[] | undefined

export type PlotSelection = { kind: PlotKind; id: string; tab?: string }

/** `/plot/[branchId]?kind&id&tab` — mirrors World's param names (parseWorldSelection). */
export function parsePlotSelection(params: {
  kind?: RawParam
  id?: RawParam
  tab?: RawParam
}): PlotSelection | null {
  const kind = single(params.kind)
  const id = single(params.id)
  if (!isPlotKind(kind) || id == null) return null
  const tab = single(params.tab)
  return tab == null ? { kind, id } : { kind, id, tab }
}

/** A deep link's tab, for its own row only. */
export function deepLinkTab(
  selection: PlotSelection | null,
  kind: PlotKind,
  id: string,
): string | undefined {
  return selection?.kind === kind && selection.id === id ? selection.tab : undefined
}

export function plotKindLabel(kind: PlotKind): string {
  return t(`plot:kinds.${kind}`)
}

export function plotAddLabel(kind: PlotKind): string {
  return t(`plot:add.${kind}`)
}
