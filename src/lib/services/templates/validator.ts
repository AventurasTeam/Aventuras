/**
 * Template Validator
 *
 * Validates templates for syntax errors, unknown variables, and unknown filters.
 * Provides user-friendly error messages for non-technical users.
 */

import { templateEngine } from './engine'
import { variableRegistry } from './variables'
import type { ValidationResult, ValidationError } from './types'
import { createLogger } from '$lib/services/ai/core/config'

const log = createLogger('TemplateValidator')

/**
 * Known LiquidJS filters
 * Complete list of built-in filters for validation.
 */
const KNOWN_FILTERS = [
  'abs',
  'append',
  'at_least',
  'at_most',
  'capitalize',
  'ceil',
  'compact',
  'concat',
  'date',
  'default',
  'divided_by',
  'downcase',
  'escape',
  'escape_once',
  'first',
  'floor',
  'join',
  'json',
  'last',
  'lstrip',
  'map',
  'minus',
  'modulo',
  'newline_to_br',
  'plus',
  'prepend',
  'remove',
  'remove_first',
  'replace',
  'replace_first',
  'reverse',
  'round',
  'rstrip',
  'size',
  'slice',
  'sort',
  'sort_natural',
  'split',
  'strip',
  'strip_html',
  'strip_newlines',
  'times',
  'truncate',
  'truncatewords',
  'uniq',
  'upcase',
  'url_decode',
  'url_encode',
  'where',
]

/**
 * Simplify LiquidJS error messages to user-friendly language
 *
 * @param rawError - Technical error message from LiquidJS
 * @returns Simplified, user-friendly message
 */
function simplifyError(rawError: string): string {
  const errorLower = rawError.toLowerCase()

  // Extract line/column info if present
  const lineMatch = rawError.match(/line (\d+)/i)
  const colMatch = rawError.match(/col(?:umn)? (\d+)/i)
  const lineInfo = lineMatch
    ? ` near line ${lineMatch[1]}${colMatch ? `, column ${colMatch[1]}` : ''}`
    : ''

  // Pattern matching for common LiquidJS errors
  if (errorLower.includes('not closed') || errorLower.includes('not found')) {
    const tagMatch = rawError.match(/tag ["']?(\w+)["']?/i)
    if (tagMatch) {
      return `Missing closing tag for '${tagMatch[1]}' statement${lineInfo}`
    }
    return `Missing closing tag${lineInfo}`
  }

  if (errorLower.includes('unexpected token')) {
    return `Unexpected syntax${lineInfo}`
  }

  if (errorLower.includes('unknown tag')) {
    const tagMatch = rawError.match(/unknown tag[:\s]+["']?(\w+)["']?/i)
    if (tagMatch) {
      return `Unknown command: '${tagMatch[1]}'. Check your spelling.`
    }
    return `Unknown command${lineInfo}. Check your spelling.`
  }

  // Default fallback - strip technical jargon
  const simplified = rawError
    .replace(/^Error:\s*/i, '')
    .split('\n')[0] // Remove stack traces (take first line only)
    .trim()

  return `Template syntax error: ${simplified}`
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for "did you mean?" suggestions.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = []

  // Initialize first column and row
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        )
      }
    }
  }

  return matrix[b.length][a.length]
}

/**
 * Find similar name using Levenshtein distance
 *
 * @param name - Name to find match for
 * @param validNames - Array of valid names to compare against
 * @param maxDistance - Maximum edit distance to consider (default: 2)
 * @returns Closest match or undefined if none found within maxDistance
 */
function findSimilar(
  name: string,
  validNames: string[],
  maxDistance: number = 2,
): string | undefined {
  let closest: string | undefined
  let closestDistance = Infinity

  for (const validName of validNames) {
    const distance = levenshtein(name.toLowerCase(), validName.toLowerCase())
    if (distance < closestDistance && distance <= maxDistance) {
      closestDistance = distance
      closest = validName
    }
  }

  return closest
}

/**
 * Extract filter names from template
 *
 * @param template - Template string to analyze
 * @returns Array of unique filter names
 */
function extractFilterNames(template: string): string[] {
  const filters = new Set<string>()

  // Match filters after pipes: {{ variable | filter }} or {{ variable | filter: arg }}
  const filterPattern = /\{\{[^}]*\|\s*(\w+)/g
  let match = filterPattern.exec(template)
  while (match !== null) {
    filters.add(match[1])
    match = filterPattern.exec(template)
  }

  return Array.from(filters)
}

/**
 * Validate a template for syntax errors, unknown variables, and unknown filters
 *
 * This function is stateless and side-effect-free - safe for real-time editor validation.
 *
 * @param template - Template string to validate
 * @param additionalVariables - Optional array of extra valid variable names (e.g., from preset packs)
 * @returns ValidationResult with valid flag and array of errors
 */
export function validateTemplate(
  template: string,
  additionalVariables?: string[],
): ValidationResult {
  const errors: ValidationError[] = []

  // Step 1: Syntax validation
  const parseResult = templateEngine.parseTemplate(template)
  if (!parseResult.success && parseResult.error) {
    log('syntax error', { error: parseResult.error })

    // Extract line/column info if present
    const lineMatch = parseResult.error.match(/line (\d+)/i)
    const colMatch = parseResult.error.match(/col(?:umn)? (\d+)/i)

    errors.push({
      type: 'syntax',
      message: simplifyError(parseResult.error),
      line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
      column: colMatch ? parseInt(colMatch[1], 10) : undefined,
    })

    // Return immediately on syntax error - no point checking variables/filters
    return { valid: false, errors }
  }

  // Step 2: Variable reference validation
  const variableNames = templateEngine.extractVariableNames(template)
  const validVariables = new Set([
    ...variableRegistry.getAllNames(),
    ...(additionalVariables || []),
  ])

  for (const varName of variableNames) {
    if (!validVariables.has(varName)) {
      // Variable doesn't exist - find similar names
      const allValidNames = Array.from(validVariables)
      const suggestion = findSimilar(varName, allValidNames)

      const message = suggestion
        ? `Variable '${varName}' doesn't exist. Did you mean '${suggestion}'?`
        : `Variable '${varName}' doesn't exist. Check the available variables list.`

      log('unknown variable', { varName, suggestion })

      errors.push({
        type: 'unknown_variable',
        message,
      })
    }
  }

  // Step 3: Filter validation
  const filterNames = extractFilterNames(template)

  for (const filterName of filterNames) {
    if (!KNOWN_FILTERS.includes(filterName)) {
      const suggestion = findSimilar(filterName, KNOWN_FILTERS)

      const message = suggestion
        ? `Filter '${filterName}' doesn't exist. Did you mean '${suggestion}'?`
        : `Filter '${filterName}' doesn't exist.`

      log('unknown filter', { filterName, suggestion })

      errors.push({
        type: 'unknown_filter',
        message,
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
