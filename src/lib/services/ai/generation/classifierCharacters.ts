/**
 * The classifier's view of existing characters: what it is shown of each one.
 */

import type { Character } from '#lib/types/index.ts'

/**
 * Format existing characters for the prompt.
 *
 * **The name is the whole of its line.** The model reads this list and writes names back,
 * so a rendered suffix — `- Ada (claimed as a consort) [inactive]` — comes back as the
 * name and mints a second character. Attributes are indented `label: value` lines
 * instead, which a name containing parentheses cannot be confused with.
 *
 * `appearance` is sent only for characters in the scene. It is there to be rewritten, and
 * only someone present can have their look updated; on a large cast it is also most of
 * the prompt. The template forbids rewriting an appearance that is not shown, so a
 * returning character keeps the descriptors it accumulated.
 */
export function formatExistingCharacters(characters: Character[]): string {
  if (characters.length === 0) return '(none)'

  return characters
    .map((c) => {
      const status = c.status ?? 'active'
      let entry = `- ${c.name}`
      if (c.relationship) entry += `\n  relationship: ${c.relationship}`
      // `active` is printed too, or the list is asymmetric: the model would be reminded to
      // report a return and never a departure.
      entry += `\n  status: ${status}`
      if (
        status === 'active' &&
        c.visualDescriptors &&
        Object.keys(c.visualDescriptors).length > 0
      ) {
        entry += `\n  appearance: ${formatVisualDescriptors(c.visualDescriptors)}`
      }
      return entry
    })
    .join('\n')
}

function formatVisualDescriptors(descriptors: Character['visualDescriptors']): string {
  if (!descriptors) return ''

  const parts: string[] = []
  if (descriptors.face) parts.push(`Face: ${descriptors.face}`)
  if (descriptors.hair) parts.push(`Hair: ${descriptors.hair}`)
  if (descriptors.eyes) parts.push(`Eyes: ${descriptors.eyes}`)
  if (descriptors.build) parts.push(`Build: ${descriptors.build}`)
  if (descriptors.clothing) parts.push(`Clothing: ${descriptors.clothing}`)
  if (descriptors.accessories) parts.push(`Accessories: ${descriptors.accessories}`)
  if (descriptors.distinguishing) parts.push(`Distinguishing: ${descriptors.distinguishing}`)

  return parts.join(', ')
}
