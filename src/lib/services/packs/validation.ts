import { z } from 'zod'

/**
 * Zod schemas for preset pack validation.
 * Used at system boundaries: pack creation, import/export.
 * NOT used for every database read (trust database integrity after validated writes).
 */

/** Valid Liquid variable name pattern: lowercase letters, numbers, underscores, must start with letter or underscore */
const variableNameRegex = /^[a-z_][a-z0-9_]*$/

/** Enum option: label for display, value for storage */
export const EnumOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
})

/** Custom variable definition within a pack */
export const CustomVariableSchema = z
  .object({
    variableName: z.string().min(1).regex(variableNameRegex, {
      message: 'Variable name must use lowercase letters, numbers, and underscores only',
    }),
    displayName: z.string().min(1),
    description: z.string().optional(),
    variableType: z.enum(['text', 'textarea', 'enum', 'number', 'boolean']),
    isRequired: z.boolean(),
    sortOrder: z.number().optional(),
    defaultValue: z.string().optional(),
    enumOptions: z.array(EnumOptionSchema).optional(),
  })
  .refine(
    (data) => {
      // Enum type must have at least one option
      if (data.variableType === 'enum') {
        return data.enumOptions && data.enumOptions.length > 0
      }
      return true
    },
    { message: 'Enum variables must have at least one option' },
  )

/** Pack template: template ID + content */
export const PackTemplateSchema = z.object({
  templateId: z.string().min(1),
  content: z.string(),
})

/** Full pack export schema (versioned for forward compatibility) */
export const PackExportSchema = z.object({
  version: z.literal(1),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().optional(),
  templates: z.array(PackTemplateSchema),
  variables: z.array(CustomVariableSchema),
})

/** Type inferred from export schema */
export type PackExport = z.infer<typeof PackExportSchema>

/**
 * Validate pack import data.
 * Returns structured result with either valid pack data or human-readable error messages.
 */
export function validatePackImport(data: unknown): {
  valid: boolean
  errors?: string[]
  pack?: PackExport
} {
  const result = PackExportSchema.safeParse(data)
  if (result.success) {
    return { valid: true, pack: result.data }
  }
  return {
    valid: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  }
}

/**
 * Validate a single custom variable definition.
 * Used when creating/editing variables in the UI.
 */
export function validateCustomVariable(data: unknown): {
  valid: boolean
  errors?: string[]
} {
  const result = CustomVariableSchema.safeParse(data)
  if (result.success) {
    return { valid: true }
  }
  return {
    valid: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  }
}
