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
  'landing',
  'reader',
  'settings',
  'storySettings',
  'wizard',
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
