/**
 * Template Engine - LiquidJS Wrapper
 *
 * Wraps LiquidJS to provide safe template rendering with error handling.
 * Templates use Jinja-like syntax: {{ variables }}, {% if %}, {% for %}, and filters.
 */

import { Liquid } from 'liquidjs'
import type { TemplateContext } from './types'
import { createLogger } from '$lib/services/ai/core/config'

const log = createLogger('TemplateEngine')

/**
 * Template Engine class
 * Provides safe template rendering and parsing functionality.
 */
class TemplateEngine {
  private liquid: Liquid

  constructor() {
    // Configure LiquidJS instance
    this.liquid = new Liquid({
      // Unknown filters should error (caught in validation, not render)
      strictFilters: true,
      // We handle unknown variables ourselves - empty string at render time
      strictVariables: false,
      // No global variables - all passed per-render
      globals: {},
      // Use JavaScript truthiness for conditionals (more intuitive)
      jsTruthy: true,
      // No file system access - templates are standalone strings
      // (no root, layouts, partials, or extname configured)
    })
  }

  /**
   * Render a template with the given context
   *
   * This is the one-pass render: one template string + one context object = one output string.
   * Never throws — returns null on error so callers can distinguish render failures
   * from intentionally empty templates.
   *
   * @param template - Template string with LiquidJS syntax
   * @param context - Flat context object with variable values
   * @returns Rendered string, or null on render error
   */
  render(template: string, context: TemplateContext): string | null {
    try {
      return this.liquid.parseAndRenderSync(template, context)
    } catch (error) {
      log('render error', { error, template: template.substring(0, 100) })
      return null
    }
  }

  /**
   * Parse a template to check for syntax errors
   *
   * Used by the validator for syntax checking.
   * Does NOT catch errors silently - this is the validation path, not the render path.
   *
   * @param template - Template string to parse
   * @returns Success status and optional error message
   */
  parseTemplate(template: string): { success: boolean; error?: string } {
    try {
      this.liquid.parse(template)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, error: message }
    }
  }

  /**
   * Extract variable names referenced in a template
   *
   * Parses the template and extracts all variable names from:
   * - Output tags: {{ variable }}
   * - Control flow tags: {% if variable %}, {% for item in list %}
   * - Assignment tags: {% assign variable = value %}
   *
   * Returns deduplicated array of variable names.
   * This enables validation of variable references without depending on the variable registry.
   *
   * @param template - Template string to analyze
   * @returns Array of unique variable names
   */
  extractVariableNames(template: string): string[] {
    const variableNames = new Set<string>()

    // Extract from output tags: {{ variable }}, {{ variable | filter }}
    // Pattern: {{ optional-spaces variableName optional-spaces-or-filter }}
    const outputPattern = /\{\{\s*([a-zA-Z_][\w.]*?)\s*(?:\||}})/g
    let match = outputPattern.exec(template)
    while (match !== null) {
      variableNames.add(match[1])
      match = outputPattern.exec(template)
    }

    // Extract from control flow and assignment tags
    // Pattern: {% if/elsif/unless/for/assign/case/when variable ... %}
    const tagPattern = /\{%\s*(?:if|elsif|unless|for|assign|case|when)\s+([a-zA-Z_][\w.]*)/g
    match = tagPattern.exec(template)
    while (match !== null) {
      variableNames.add(match[1])
      match = tagPattern.exec(template)
    }

    // Extract from 'for' loops: {% for item in collection %}
    const forInPattern = /\{%\s*for\s+[a-zA-Z_][\w.]*\s+in\s+([a-zA-Z_][\w.]*)/g
    match = forInPattern.exec(template)
    while (match !== null) {
      variableNames.add(match[1])
      match = forInPattern.exec(template)
    }

    return Array.from(variableNames)
  }
}

/**
 * Singleton template engine instance
 * Use this throughout the application for template rendering.
 */
export const templateEngine = new TemplateEngine()
