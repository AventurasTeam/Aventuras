import * as z from 'zod'
import type { ImageModelCapabilities } from '#lib/types/index.ts'
import type { ImageModelInfo } from './types'

export const optionalString = z.string().optional().catch(undefined)
export const optionalNumber = z.number().optional().catch(undefined)
export const optionalStrings = z.array(z.string()).optional().catch(undefined)

export const architectureSchema = z
  .object({ input_modalities: optionalStrings, output_modalities: optionalStrings })
  .optional()
  .catch(undefined)

export const nonEmpty = <T>(list?: T[]): T[] | undefined => (list?.length ? list : undefined)

/**
 * Whether a model takes reference images. A positive count or an image input says yes, and wins
 * over a listed zero: when the signals conflict, references are allowed. A zero alone says no, as
 * do readable inputs without an image; unreadable inputs stay unknown.
 */
export function referenceSupport(
  inputs: string[] | undefined,
  maxReferenceImages: number | undefined,
): boolean | undefined {
  if (maxReferenceImages !== undefined && maxReferenceImages > 0) return true
  if (inputs?.includes('image')) return true
  if (maxReferenceImages === 0) return false
  return inputs ? false : undefined
}

/** Only a model that takes images and no text is reference-only; unreadable inputs are not. */
export const editsOnly = (inputs: string[] | undefined): boolean =>
  !!inputs?.includes('image') && !inputs.includes('text')

/** A catalogue entry that names its modalities, with the capabilities read from it. */
export function catalogueModelInfo(
  m: {
    id: string
    name?: string
    description?: string
    architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  },
  capabilities: ImageModelCapabilities,
): ImageModelInfo {
  return {
    id: m.id,
    name: m.name || m.id,
    description: m.description,
    inputModalities: m.architecture?.input_modalities,
    outputModalities: m.architecture?.output_modalities,
    ...capabilities,
  }
}
