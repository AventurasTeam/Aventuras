import type { TemplateInitialState } from '$lib/types'

/**
 * Quick Start Seed - pre-configured data for the story wizard
 * These provide a fast path to story creation by pre-populating wizard fields.
 * Unlike the old BUILTIN_TEMPLATES, these do NOT contain system prompts -
 * all stories use the centralized prompt system.
 */
export interface QuickStartSeed {
  id: string
  name: string
  description: string
  genre: string
  initialState: TemplateInitialState
}

/**
 * Quick Start Seeds - pre-configured scenarios for fast story setup
 * Each seed provides initial values for the wizard (genre, setting, protagonist, etc.)
 * The actual system prompt comes from the centralized prompt system based on mode.
 */
export const QUICK_START_SEEDS: QuickStartSeed[] = [
  {
    id: 'fantasy-adventure',
    name: 'Fantasy Adventure',
    description:
      'Epic quests, magic, mythical creatures, and heroic journeys in a medieval fantasy world.',
    genre: 'Fantasy',
    initialState: {
      protagonist: {
        name: 'The Adventurer',
        description: 'A brave soul seeking glory and purpose',
        traits: ['brave', 'curious', 'determined'],
      },
      startingLocation: {
        name: 'The Crossroads Inn',
        description:
          'A weathered tavern where travelers share tales of distant lands and rumors of adventure.',
      },
    },
  },
  {
    id: 'scifi-exploration',
    name: 'Sci-Fi Exploration',
    description:
      'Explore the cosmos, encounter alien civilizations, and unravel the mysteries of the universe.',
    genre: 'Sci-Fi',
    initialState: {
      protagonist: {
        name: 'The Captain',
        description:
          'Commander of a small independent vessel, seeking fortune and discovery among the stars',
        traits: ['resourceful', 'adaptable', 'ambitious'],
      },
      startingLocation: {
        name: 'Nexus Station',
        description:
          'A bustling space station at the intersection of major trade routes, home to traders, mercenaries, and those seeking to disappear.',
      },
    },
  },
  {
    id: 'mystery-investigation',
    name: 'Mystery Investigation',
    description:
      'Solve intricate puzzles, uncover hidden truths, and bring justice to light as a detective.',
    genre: 'Mystery',
    initialState: {
      protagonist: {
        name: 'The Detective',
        description: 'A sharp-minded investigator with an eye for detail and a nose for deception',
        traits: ['observant', 'persistent', 'analytical'],
      },
      startingLocation: {
        name: 'The Crime Scene',
        description: 'An elegant study in a wealthy estate, now cordoned off with police tape.',
      },
    },
  },
  {
    id: 'horror-survival',
    name: 'Horror Survival',
    description:
      'Face your fears, survive the night, and confront the darkness that lurks in the shadows.',
    genre: 'Horror',
    initialState: {
      protagonist: {
        name: 'The Survivor',
        description: 'An ordinary person thrust into extraordinary horror',
        traits: ['resourceful', 'frightened', 'determined'],
      },
      startingLocation: {
        name: 'The Old House',
        description:
          'A decrepit Victorian mansion on the outskirts of town, long abandoned -until tonight.',
      },
    },
  },
  {
    id: 'slice-of-life',
    name: 'Slice of Life',
    description:
      'Experience everyday moments, build relationships, and find meaning in the ordinary.',
    genre: 'Slice of Life',
    initialState: {
      protagonist: {
        name: 'You',
        description: 'Someone at a crossroads in life, seeking connection and meaning',
        traits: ['thoughtful', 'kind', 'searching'],
      },
      startingLocation: {
        name: 'Your New Apartment',
        description:
          'A small but cozy apartment in a new city, boxes still waiting to be unpacked.',
      },
    },
  },
  {
    id: 'historical-drama',
    name: 'Historical Drama',
    description:
      'Live through pivotal moments in history, navigating political intrigue and personal struggles.',
    genre: 'Historical',
    initialState: {
      protagonist: {
        name: 'The Noble',
        description: 'A member of a declining aristocratic family seeking to restore their legacy',
        traits: ['cunning', 'proud', 'conflicted'],
      },
      startingLocation: {
        name: 'The Royal Court',
        description:
          'A grand palace filled with whispered schemes and dangerous alliances, where every smile hides a dagger.',
      },
    },
  },
]
