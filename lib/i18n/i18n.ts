import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'

import common from '@/locales/en/common.json'
import embedder from '@/locales/en/embedder.json'
import landing from '@/locales/en/landing.json'
import reader from '@/locales/en/reader.json'
import settings from '@/locales/en/settings.json'
import storySettings from '@/locales/en/story-settings.json'
import wizard from '@/locales/en/wizard.json'

const resources = {
  en: { common, embedder, landing, reader, settings, storySettings, wizard },
} as const

// Synchronous init: resources are bundled, no async backend. The instance is
// usable (i18n.t) the moment this module is imported — before any boot logic —
// so the pre-Router recovery screen can resolve copy without the React provider.
export const i18n = createInstance()
void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'embedder', 'landing', 'reader', 'settings', 'storySettings', 'wizard'],
  defaultNS: 'common',
  returnNull: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
})

export const t = i18n.t.bind(i18n)

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof resources.en
  }
}
