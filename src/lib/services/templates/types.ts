/**
 * Template System - Type Definitions
 *
 * This module defines the types for the new Jinja-like template system.
 * Templates use LiquidJS syntax with {{ variable }}, {% if %}, {% for %}, and filters.
 */

/**
 * Variable data type
 * Defines what kind of value a variable holds.
 */
export type VariableType = 'text' | 'number' | 'boolean' | 'enum'

/**
 * Variable category
 * - system: Auto-filled by the application (e.g., protagonistName, mode)
 * - runtime: Injected by services at render time (e.g., recentContent, userInput)
 * - custom: User-defined variables in preset packs
 */
export type VariableCategory = 'system' | 'runtime' | 'custom'

/**
 * Variable definition
 * Describes a variable that can be used in templates.
 */
export interface VariableDefinition {
  /** Variable name used in templates (e.g., 'protagonistName') */
  name: string
  /** Data type of the variable */
  type: VariableType
  /** Category (system, runtime, or custom) */
  category: VariableCategory
  /** Human-readable description for non-technical users */
  description: string
  /** Whether this variable must have a value */
  required: boolean
  /** Optional default value */
  defaultValue?: string | number | boolean
  /** Available options when type is 'enum' */
  enumValues?: string[]
}

/**
 * Template context
 * The flat context object passed to render().
 * Simple values only - no nested objects, no variable references to other variables.
 */
export type TemplateContext = Record<string, string | number | boolean | string[] | undefined>

/**
 * Validation error type
 */
export type ValidationErrorType = 'syntax' | 'unknown_variable' | 'unknown_filter'

/**
 * Validation error
 * Describes an issue found during template validation.
 */
export interface ValidationError {
  /** Error type */
  type: ValidationErrorType
  /** User-friendly message (non-technical wording) */
  message: string
  /** Line number where error occurred (if available) */
  line?: number
  /** Column number where error occurred (if available) */
  column?: number
}

/**
 * Validation result
 * Result of template validation check.
 */
export interface ValidationResult {
  /** Whether the template is valid */
  valid: boolean
  /** List of errors found (empty if valid) */
  errors: ValidationError[]
}

/**
 * Render result (internal use)
 * Result of template rendering operation.
 */
export interface RenderResult {
  /** Rendered output string */
  output: string
  /** Error message if render failed (bug scenario) */
  error?: string
}
