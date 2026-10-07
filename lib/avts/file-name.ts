const SLUG_MAX = 60

/** `<prefix>-<slug>.avts`, or `<prefix>.avts` when the name folds to nothing. */
export function avtsFileName(prefix: string, name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug === '' ? `${prefix}.avts` : `${prefix}-${slug}.avts`
}
