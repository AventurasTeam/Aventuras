import type { StoryInfo, StoryInfoPatch } from '@/lib/db'
import { HEX_COLOR } from '@/lib/hex-color'
import { CURATED_ACCENT_PALETTE, CURATED_ACCENT_SLOTS } from '@/lib/themes'

export type AboutDraft = {
  title: string
  description: string
  tags: string[]
  accentColor: string | null
  status: StoryInfo['status']
  favorite: boolean
}

export type AboutKey = keyof AboutDraft

/** Why a dirty draft can't be written — each one a refusal the save would otherwise hit at commit. */
export type AboutProblem = 'draft-story' | 'empty-title' | 'invalid-accent'

/** Field order on the tab; drives the save bar's label order within the section. */
export const ABOUT_KEYS: readonly AboutKey[] = [
  'title',
  'description',
  'tags',
  'accentColor',
  'status',
  'favorite',
]

export const ACCENT_SWATCHES: string[] = CURATED_ACCENT_SLOTS.map(
  (slot) => CURATED_ACCENT_PALETTE[slot],
)

// Trimmed, blank as null — on both sides of the dirty check: the wizard stores it untrimmed.
function descriptionColumn(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// The column schema refuses a blank tag, so a stored one is dropped, never re-sent.
function tagsColumn(tags: readonly string[]): string[] {
  return tags.map((tag) => tag.trim()).filter((tag) => tag !== '')
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

// Case-insensitive, as ColorPicker matches the selected swatch.
function sameAccent(a: string | null, b: string | null): boolean {
  return a == null || b == null ? a === b : a.toLowerCase() === b.toLowerCase()
}

export function toAboutDraft(story: StoryInfo): AboutDraft {
  return {
    title: story.title,
    description: story.description ?? '',
    tags: tagsColumn(story.tags),
    accentColor: story.accentColor,
    status: story.status,
    favorite: story.favorite === 1,
  }
}

function changed(key: AboutKey, draft: AboutDraft, baseline: AboutDraft): boolean {
  switch (key) {
    case 'title':
      return draft.title.trim() !== baseline.title.trim()
    case 'description':
      return descriptionColumn(draft.description) !== descriptionColumn(baseline.description)
    case 'tags':
      return !sameTags(tagsColumn(draft.tags), tagsColumn(baseline.tags))
    case 'accentColor':
      return !sameAccent(draft.accentColor, baseline.accentColor)
    case 'status':
      return draft.status !== baseline.status
    case 'favorite':
      return draft.favorite !== baseline.favorite
  }
}

export function aboutDirtyKeys(draft: AboutDraft, baseline: AboutDraft): AboutKey[] {
  return ABOUT_KEYS.filter((key) => changed(key, draft, baseline))
}

/**
 * Only dirty keys are checked, so a stored value the column schema would refuse
 * can't block an unrelated edit — the patch never re-sends it.
 */
export function validateAbout(draft: AboutDraft, baseline: AboutDraft): AboutProblem | null {
  const dirty = aboutDirtyKeys(draft, baseline)
  if (dirty.length === 0) return null
  // `saveStorySettingsSession` rejects every column patch on a draft story.
  if (baseline.status === 'draft') return 'draft-story'
  if (dirty.includes('title') && draft.title.trim() === '') return 'empty-title'
  const accent = draft.accentColor
  if (dirty.includes('accentColor') && accent != null && !HEX_COLOR.test(accent)) {
    return 'invalid-accent'
  }
  return null
}

/** Only the changed columns; `status` is never patched to `draft`. */
export function aboutColumnPatch(draft: AboutDraft, baseline: AboutDraft): StoryInfoPatch {
  const patch: StoryInfoPatch = {}
  for (const key of aboutDirtyKeys(draft, baseline)) {
    if (key === 'title') patch.title = draft.title.trim()
    else if (key === 'description') patch.description = descriptionColumn(draft.description)
    else if (key === 'tags') patch.tags = tagsColumn(draft.tags)
    else if (key === 'accentColor') patch.accentColor = draft.accentColor
    else if (key === 'status' && draft.status !== 'draft') patch.status = draft.status
    else if (key === 'favorite') patch.favorite = draft.favorite
  }
  return patch
}
