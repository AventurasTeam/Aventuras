import * as z from 'zod'

export const optionalString = z.string().optional().catch(undefined)
export const optionalNumber = z.number().optional().catch(undefined)
export const optionalStrings = z.array(z.string()).optional().catch(undefined)

export const architectureSchema = z
  .object({ input_modalities: optionalStrings, output_modalities: optionalStrings })
  .optional()
  .catch(undefined)

export const nonEmpty = <T>(list?: T[]): T[] | undefined => (list?.length ? list : undefined)

/**
 * Whether a model takes reference images. One that takes images but lists no reference count
 * still takes references; one whose inputs could not be read stays unknown.
 */
export function referenceSupport(
  inputs: string[] | undefined,
  maxReferenceImages: number | undefined,
): boolean | undefined {
  if (maxReferenceImages || inputs?.includes('image')) return true
  return inputs ? false : undefined
}

/** Only a model that takes images and no text is reference-only; unreadable inputs are not. */
export const editsOnly = (inputs: string[] | undefined): boolean =>
  !!inputs?.includes('image') && !inputs.includes('text')
