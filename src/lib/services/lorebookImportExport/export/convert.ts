/**
 * Convert Entry objects to SillyTavern format
 */

import type { Entry } from '$lib/types'
import type { SillyTavernEntry } from '../types'

export function entryToSillyTavern(entry: Entry, index: number): SillyTavernEntry {
  const keywords = [entry.name, ...entry.aliases, ...entry.injection.keywords]

  return {
    uid: index,
    key: keywords,
    keysecondary: [],
    comment: entry.name,
    content: entry.description + (entry.hiddenInfo ? `\n\n[Hidden: ${entry.hiddenInfo}]` : ''),
    constant: entry.injection.mode === 'always',
    vectorized: false,
    selective: entry.injection.mode === 'keyword',
    selectiveLogic: 0,
    addMemo: true,
    order: entry.injection.priority,
    position: 0,
    disable: entry.injection.mode === 'never',
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: 0,
    probability: 100,
    useProbability: false,
    depth: 4,
    group: entry.type,
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: false,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: null,
    sticky: null,
    cooldown: null,
    delay: null,
    displayIndex: index,
    ignoreBudget: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    outletName: '',
    triggers: [],
    characterFilter: {
      isExclude: false,
      names: [],
      tags: [],
    },
  }
}
