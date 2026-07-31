import type { SuggestionCategory } from './story-config-schema'

// reader-composer.md → Next-turn suggestions. Copied into a story at creation
// via app_settings.default_suggestion_categories[mode]; the story owns its
// values thereafter. Ids are stable literals, not UUIDs: they are per-story
// handles and a fresh story copies this array wholesale, so uniqueness within
// one palette is the only requirement.
export const DEFAULT_SUGGESTION_CATEGORIES: Record<
  'adventure' | 'creative',
  readonly SuggestionCategory[]
> = {
  adventure: [
    {
      id: 'cat_action',
      label: 'Action',
      promptHint: 'A decisive physical move the lead makes right now.',
      color: 'red',
      enabled: true,
      order: 0,
    },
    {
      id: 'cat_dialogue',
      label: 'Dialogue',
      promptHint: 'Something the lead says aloud to someone present.',
      color: 'blue',
      enabled: true,
      order: 1,
    },
    {
      id: 'cat_examine',
      label: 'Examine',
      promptHint: 'The lead studies a person, object, or detail of the scene.',
      color: 'teal',
      enabled: true,
      order: 2,
    },
    {
      id: 'cat_move',
      label: 'Move',
      promptHint: 'The lead goes somewhere — toward, away, or through.',
      color: 'green',
      enabled: true,
      order: 3,
    },
  ],
  creative: [
    {
      id: 'cat_action',
      label: 'Action',
      promptHint: 'A decisive physical beat that moves the scene forward.',
      color: 'red',
      enabled: true,
      order: 0,
    },
    {
      id: 'cat_dialogue',
      label: 'Dialogue',
      promptHint: 'A line of speech that shifts the exchange.',
      color: 'blue',
      enabled: true,
      order: 1,
    },
    {
      id: 'cat_revelation',
      label: 'Revelation',
      promptHint: 'Something hidden becomes known to a character or the reader.',
      color: 'indigo',
      enabled: true,
      order: 2,
    },
    {
      id: 'cat_twist',
      label: 'Twist',
      promptHint: 'A turn that overturns what the scene seemed to be about.',
      color: 'pink',
      enabled: true,
      order: 3,
    },
  ],
}
