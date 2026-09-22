import { describe, it, expect } from 'vitest'
import {
  GENRE_COLORS,
  GENRE_COLOR_KEYS,
  NEUTRAL_GENRE_BADGE,
  resolveGenreColor,
} from './genreColors'

describe('resolveGenreColor', () => {
  it('offers exactly ten colours', () => {
    expect(GENRE_COLOR_KEYS).toHaveLength(10)
  })

  it('uses the saved colour over the genre name', () => {
    expect(resolveGenreColor('Fantasy', 'teal')).toBe(GENRE_COLORS.teal.badge)
  })

  it('colours a custom genre when a colour is saved', () => {
    expect(resolveGenreColor('Noir', 'pink')).toBe(GENRE_COLORS.pink.badge)
  })

  it('falls back to the genre name for a key it does not know', () => {
    // A newer build could add a colour and sync the story here; the badge must not go blank.
    expect(resolveGenreColor('Horror', 'chartreuse')).toBe(GENRE_COLORS.red.badge)
  })

  it('keeps the colours the preset genres had before a colour could be chosen', () => {
    expect(resolveGenreColor('Fantasy')).toBe(
      'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20',
    )
    expect(resolveGenreColor('Sci-Fi')).toBe(
      'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
    )
    expect(resolveGenreColor('Mystery')).toBe(
      'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20',
    )
    expect(resolveGenreColor('Horror')).toBe(
      'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20',
    )
    expect(resolveGenreColor('Slice of Life')).toBe(
      'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20',
    )
    expect(resolveGenreColor('Historical')).toBe(
      'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20',
    )
  })

  it('leaves any other genre neutral', () => {
    expect(resolveGenreColor('Noir')).toBe(NEUTRAL_GENRE_BADGE)
    expect(resolveGenreColor('Noir', null)).toBe(NEUTRAL_GENRE_BADGE)
    expect(resolveGenreColor(null)).toBe(NEUTRAL_GENRE_BADGE)
  })

  it('does not treat inherited object keys as colours', () => {
    expect(resolveGenreColor('Noir', 'toString')).toBe(NEUTRAL_GENRE_BADGE)
  })
})
