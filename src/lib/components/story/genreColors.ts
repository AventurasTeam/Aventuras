/**
 * The colours a library genre badge can take. A story may pick one of these (saved as its key in
 * `StorySettings.genreColor`); without a pick, the badge is coloured by genre name.
 *
 * Every class string is written out in full: Tailwind only generates classes it can find
 * literally in the source, so building them from the key would ship badges with no colour.
 */
export const GENRE_COLORS = {
  purple: {
    label: 'Purple',
    badge: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20',
    swatch: 'bg-purple-500',
  },
  cyan: {
    label: 'Cyan',
    badge: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
    swatch: 'bg-cyan-500',
  },
  amber: {
    label: 'Amber',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20',
    swatch: 'bg-amber-500',
  },
  red: {
    label: 'Red',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20',
    swatch: 'bg-red-500',
  },
  green: {
    label: 'Green',
    badge: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20',
    swatch: 'bg-green-500',
  },
  orange: {
    label: 'Orange',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20',
    swatch: 'bg-orange-500',
  },
  blue: {
    label: 'Blue',
    badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20',
    swatch: 'bg-blue-500',
  },
  pink: {
    label: 'Pink',
    badge: 'bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/20',
    swatch: 'bg-pink-500',
  },
  teal: {
    label: 'Teal',
    badge: 'bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/20',
    swatch: 'bg-teal-500',
  },
  slate: {
    label: 'Slate',
    badge: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/20',
    swatch: 'bg-slate-500',
  },
} as const

export type GenreColorKey = keyof typeof GENRE_COLORS

export const GENRE_COLOR_KEYS = Object.keys(GENRE_COLORS) as GenreColorKey[]

export const NEUTRAL_GENRE_BADGE = 'bg-secondary text-secondary-foreground border-border'

/** Default colour for each wizard preset genre. */
const PRESET_GENRE_COLORS: Record<string, GenreColorKey> = {
  Fantasy: 'purple',
  'Sci-Fi': 'cyan',
  Mystery: 'amber',
  Horror: 'red',
  'Slice of Life': 'green',
  Historical: 'orange',
}

export function isGenreColorKey(key: string | null | undefined): key is GenreColorKey {
  return !!key && Object.hasOwn(GENRE_COLORS, key)
}

/**
 * The badge classes for a genre: the story's own pick first, then the preset genre's colour,
 * then neutral. A key this build does not know — one written by a newer version and carried in by
 * sync — is passed over rather than trusted, so the badge still gets a colour.
 */
export function resolveGenreColor(genre: string | null | undefined, key?: string | null): string {
  if (isGenreColorKey(key)) return GENRE_COLORS[key].badge
  // Own properties only: a genre is free text, and `toString` would otherwise resolve to
  // `Object.prototype`'s method and take the badge lookup with it.
  const preset =
    genre && Object.hasOwn(PRESET_GENRE_COLORS, genre) ? PRESET_GENRE_COLORS[genre] : undefined
  return preset ? GENRE_COLORS[preset].badge : NEUTRAL_GENRE_BADGE
}
