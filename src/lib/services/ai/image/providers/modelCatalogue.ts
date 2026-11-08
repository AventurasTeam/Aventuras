import * as z from 'zod'

export const optionalString = z.string().optional().catch(undefined)
export const optionalNumber = z.number().optional().catch(undefined)
export const optionalStrings = z.array(z.string()).optional().catch(undefined)

export const architectureSchema = z
  .object({ input_modalities: optionalStrings, output_modalities: optionalStrings })
  .optional()
  .catch(undefined)

export const nonEmpty = <T>(list?: T[]): T[] | undefined => (list?.length ? list : undefined)
