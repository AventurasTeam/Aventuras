/**
 * Visual Descriptors Utilities
 *
 * Single source of truth for converting between VisualDescriptors object
 * and display strings (for UI editing).
 */

import type { VisualDescriptors } from '$lib/types'

const CATEGORY_ORDER: (keyof VisualDescriptors)[] = [
  'face',
  'hair',
  'eyes',
  'build',
  'clothing',
  'accessories',
  'distinguishing',
]

const CATEGORY_LABELS: Record<keyof VisualDescriptors, string> = {
  face: 'Face',
  hair: 'Hair',
  eyes: 'Eyes',
  build: 'Build',
  clothing: 'Clothing',
  accessories: 'Accessories',
  distinguishing: 'Distinguishing',
}

/**
 * Convert VisualDescriptors object to a display string for editing.
 */
export function descriptorsToString(descriptors: VisualDescriptors | null | undefined): string {
  if (!descriptors) return ''

  const parts: string[] = []
  for (const key of CATEGORY_ORDER) {
    if (descriptors[key]) {
      parts.push(`${CATEGORY_LABELS[key]}: ${descriptors[key]}`)
    }
  }
  return parts.join(', ')
}

/**
 * Parse an edit string back to VisualDescriptors object.
 */
export function stringToDescriptors(input: string): VisualDescriptors {
  if (!input.trim()) return {}

  const result: VisualDescriptors = {}
  const categoryPattern = /\b(Face|Hair|Eyes|Build|Clothing|Accessories|Distinguishing):\s*/gi

  const parts = input.split(categoryPattern).filter(Boolean)
  for (let i = 0; i < parts.length - 1; i += 2) {
    const category = parts[i].toLowerCase() as keyof VisualDescriptors
    const value = parts[i + 1].replace(/,\s*$/, '').trim()
    if (value && category in CATEGORY_LABELS) {
      result[category] = value
    }
  }

  return result
}

/**
 * Check if a VisualDescriptors object has any content.
 */
export function hasDescriptors(descriptors: VisualDescriptors | null | undefined): boolean {
  if (!descriptors) return false
  return Object.values(descriptors).some((v) => v && v.trim())
}

/**
 * Format descriptors for display in prompts/context.
 */
export function formatDescriptorsForPrompt(
  descriptors: VisualDescriptors | null | undefined,
): string {
  if (!descriptors) return ''

  const parts: string[] = []
  for (const key of CATEGORY_ORDER) {
    if (descriptors[key]) {
      parts.push(`${CATEGORY_LABELS[key]}: ${descriptors[key]}`)
    }
  }
  return parts.join(', ')
}
