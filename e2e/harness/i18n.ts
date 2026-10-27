import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createInstance } from 'i18next'

// Loose signature on purpose: lib/i18n augments the i18next module with the
// app's resource types (strict keys), which we don't want to duplicate in the
// harness — selectors pass keys as plain strings.
type Translate = (key: string, options?: Record<string, unknown>) => string

// Namespace → locale filename (storySettings is kebab on disk). Mirrors the
// app's i18n init (lib/i18n/i18n.ts) so selectors resolve the exact strings the
// app renders — including interpolation and plurals — instead of hardcoded
// English that rots as copy changes. The react-i18next plugin is omitted: it
// only backs the React hooks, not t(), so a bare i18next instance is faithful.
const NAMESPACES = [
  'common',
  'embedder',
  'history',
  'landing',
  'plot',
  'reader',
  'settings',
  'storySettings',
  'wizard',
  'world',
] as const

const FILE_OVERRIDE: Partial<Record<(typeof NAMESPACES)[number], string>> = {
  storySettings: 'story-settings',
}

const LOCALES_DIR = join(__dirname, '..', '..', 'locales', 'en')

function loadNamespace(ns: (typeof NAMESPACES)[number]): unknown {
  const file = FILE_OVERRIDE[ns] ?? ns
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${file}.json`), 'utf8'))
}

let cached: Translate | undefined

export const t: Translate = (key, options) => {
  if (!cached) {
    // Cast to a loose shape: the app's global i18next augmentation types both
    // init() options and t() keys against the app resources, which we don't
    // mirror here.
    const instance = createInstance() as unknown as {
      init: (options: Record<string, unknown>) => void
      t: Translate
    }
    instance.init({
      resources: { en: Object.fromEntries(NAMESPACES.map((ns) => [ns, loadNamespace(ns)])) },
      lng: 'en',
      fallbackLng: 'en',
      ns: [...NAMESPACES],
      defaultNS: 'common',
      returnNull: false,
      interpolation: { escapeValue: false },
    })
    cached = instance.t.bind(instance)
  }
  return cached(key, options)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `{{n, number}}` groups digits, so a number slot's sentinel is found as the app formats it.
const NUMBER_SENTINEL = 987_654_000
const formatNumber = new Intl.NumberFormat('en')

/**
 * `key`'s copy as an anchored pattern, for copy that interpolates values no spec can know: each
 * `numbers` slot becomes a named group matching a formatted number, each `texts` slot one matching
 * any text, and `fixed` values resolve as given. Throws when a slot doesn't render as expected.
 */
export function copyPattern(
  key: string,
  slots: {
    fixed?: Record<string, unknown>
    numbers?: readonly string[]
    texts?: readonly string[]
  },
): RegExp {
  const values: Record<string, unknown> = { ...slots.fixed }
  const groups: { name: string; sentinel: string; group: string }[] = []
  for (const [i, name] of (slots.numbers ?? []).entries()) {
    values[name] = NUMBER_SENTINEL + i
    groups.push({
      name,
      sentinel: formatNumber.format(NUMBER_SENTINEL + i),
      group: `(?<${name}>[\\d,]+)`,
    })
  }
  for (const [i, name] of (slots.texts ?? []).entries()) {
    values[name] = `@@TEXT${i}@@`
    groups.push({ name, sentinel: `@@TEXT${i}@@`, group: `(?<${name}>.+?)` })
  }
  let source = escapeRegExp(t(key, values))
  for (const { name, sentinel, group } of groups) {
    const escaped = escapeRegExp(sentinel)
    if (!source.includes(escaped)) {
      throw new Error(`${key} renders no {{${name}}} slot where copyPattern looks for it`)
    }
    source = source.replace(escaped, group)
  }
  return new RegExp(`^${source}$`, 's')
}

/** A `numbers` slot read back out of a copyPattern match. */
export function copyNumber(match: RegExpExecArray | null, name: string): number {
  const formatted = match?.groups?.[name]
  if (formatted === undefined) throw new Error(`the copy carried no ${name}`)
  return Number(formatted.replace(/,/g, ''))
}
