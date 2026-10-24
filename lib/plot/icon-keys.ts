// data-model.md → threads: the preset catalog `threads.icon` / `happenings.icon` key into, as stable
// strings rather than Lucide names. Out of components/plot so the pass's reply schema can list it.
const KEYS = [
  'sparkles',
  'eye',
  'handshake',
  'door',
  'swords',
  'flame',
  'mask',
  'scroll',
  'key',
  'skull',
  'crown',
  'map',
  'heart',
  'shield',
  'coins',
  'book',
] as const

export type PlotIconKey = (typeof KEYS)[number]

export const PLOT_ICON_KEYS: readonly PlotIconKey[] = KEYS

/** A catalog key, never an inherited property name such as `constructor`. */
export function isPlotIconKey(key: string): key is PlotIconKey {
  return (PLOT_ICON_KEYS as readonly string[]).includes(key)
}
