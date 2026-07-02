export const SUBSTITUTABLE_PREFIXES = [
  'char',
  'loc',
  'item',
  'fact',
  'lore',
  'thr',
  'hap',
  'chap',
] as const

export type SubstitutablePrefix = (typeof SUBSTITUTABLE_PREFIXES)[number]

export const ID_PATTERN = new RegExp(
  `^(${SUBSTITUTABLE_PREFIXES.join('|')})_` +
    `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
)

export const PLACEHOLDER_PREFIX_BY_KIND: Record<SubstitutablePrefix, string> = {
  char: 'c',
  loc: 'l',
  item: 'i',
  fact: 'f',
  lore: 'lo',
  thr: 'th',
  hap: 'hp',
  chap: 'ck',
}

// Multi-char prefixes first so the alternation prefers `lo` over `l` etc.
const PLACEHOLDER_PREFIXES = Object.values(PLACEHOLDER_PREFIX_BY_KIND).sort(
  (a, b) => b.length - a.length,
)

export const PLACEHOLDER_PATTERN = new RegExp(`^(${PLACEHOLDER_PREFIXES.join('|')})\\d+$`)
