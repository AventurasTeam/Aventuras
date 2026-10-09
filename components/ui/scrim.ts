import { useTheme, type Theme } from '@/lib/themes'

// spacing.md → Depth metaphor: the modal scrim is fixed per mode, not a theme color.
export const SCRIM_OPACITY: Record<Theme['mode'], number> = { light: 0.4, dark: 0.6 }

// Literal, for Tailwind's scan; each spells the opacity above it.
const SCRIM_CLASS: Record<Theme['mode'], string> = { light: 'bg-black/40', dark: 'bg-black/60' }

/** The modal scrim as a class, for overlays styled through className. */
export function useScrimClass(): string {
  const { theme } = useTheme()
  return SCRIM_CLASS[theme.mode]
}
