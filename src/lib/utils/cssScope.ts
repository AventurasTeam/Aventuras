/**
 * Scope CSS selectors by prefixing with a class.
 * Shared utility for HTML sanitization and streaming.
 */
export function scopeCssSelectors(css: string, scopeClass: string): string {
  // Handle @keyframes specially - don't prefix the keyframe name
  let result = css

  // Process @keyframes blocks - extract and preserve them
  const keyframesBlocks: string[] = []
  result = result.replace(/@keyframes\s+([^\s{]+)\s*\{([\s\S]*?\})\s*\}/gi, (match) => {
    keyframesBlocks.push(match)
    return `__KEYFRAMES_${keyframesBlocks.length - 1}__`
  })

  // Process @media queries - scope selectors inside them
  result = result.replace(/@media\s+([^{]+)\{([\s\S]*?)\}/gi, (_match, query, content) => {
    const scopedContent = prefixSelectorsInBlock(content, scopeClass)
    return `@media ${query}{${scopedContent}}`
  })

  // Process regular CSS rules
  result = prefixSelectorsInBlock(result, scopeClass)

  // Restore keyframes blocks
  keyframesBlocks.forEach((block, index) => {
    result = result.replace(`__KEYFRAMES_${index}__`, block)
  })

  return result
}

/**
 * Prefix selectors in a CSS block.
 */
function prefixSelectorsInBlock(css: string, scopeClass: string): string {
  // Match selector { properties } patterns
  return css.replace(/([^{}@]+?)(\{[^{}]*\})/g, (match, selectors, block) => {
    // A `@keyframes` block has already been swapped out for a `__KEYFRAMES_n__` placeholder,
    // and that placeholder lands in the same chunk as whatever selector follows it --
    // `__KEYFRAMES_0__ .a` is one match, not two. Split the placeholder off instead of
    // skipping the whole chunk: treating it as an unscopable selector left *every rule
    // after an animation* unscoped, which is precisely the leak this module exists to
    // prevent. Rules before the animation were scoped normally, so it looked like it worked.
    const leading = /^\s*(?:__KEYFRAMES_\d+__\s*)*/.exec(selectors)?.[0] ?? ''
    const trimmedSelectors = selectors.slice(leading.length).trim()

    // Skip if empty or starts with @
    if (!trimmedSelectors || trimmedSelectors.startsWith('@')) {
      return match
    }

    // Skip percentage selectors (keyframe steps)
    if (
      /^\d+%$/.test(trimmedSelectors) ||
      trimmedSelectors === 'from' ||
      trimmedSelectors === 'to'
    ) {
      return match
    }

    // Prefix each selector. Split the placeholder-stripped text, not the raw chunk, or the
    // placeholder ends up inside the first selector and the restored @keyframes block with it.
    const prefixedSelectors = trimmedSelectors
      .split(',')
      .map((s: string) => {
        const trimmed = s.trim()
        if (!trimmed) return s

        // Handle :root specially
        if (trimmed === ':root') {
          return `.${scopeClass}`
        }

        return `.${scopeClass} ${trimmed}`
      })
      .join(', ')

    return `${leading}${prefixedSelectors}${block}`
  })
}
