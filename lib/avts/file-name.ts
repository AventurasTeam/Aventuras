const SLUG_MAX = 60

// Lowercase letters NFKD does not decompose, so the fold would otherwise drop them.
const UNSPLITTABLE: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
}

/** `<prefix>-<slug>.avts`, or `<prefix>.avts` when the name folds to nothing. */
export function avtsFileName(prefix: string, name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (ch) => UNSPLITTABLE[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  return slug === '' ? `${prefix}.avts` : `${prefix}-${slug}.avts`
}
