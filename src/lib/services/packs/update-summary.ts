import { isUntouched } from './pack-service'
import type { PackExport } from './validation'
import type { CustomVariable, PackTemplate } from './types'

/** What an update is about to cost, for the confirmation that precedes it. */
export interface PackUpdateSummary {
  /** Templates carrying a user edit the update will discard. */
  editedTemplates: number
  /** Stories that will narrate from the file's templates on their next turn. */
  storyCount: number
  /** Variable names the file introduces. */
  addedVariables: string[]
  /** Variable names the file drops. */
  removedVariables: string[]
}

/**
 * Compare a pack against the file about to replace it.
 *
 * Edits are counted with `isUntouched` -- "did the user change this?" -- not against the
 * app's current shipped text, which also flags templates the user never touched but a later
 * app version has since improved.
 */
export function packUpdateSummary(args: {
  currentTemplates: Pick<PackTemplate, 'contentHash' | 'baselineHash'>[]
  currentVariables: Pick<CustomVariable, 'variableName'>[]
  packData: PackExport
  storyCount: number
}): PackUpdateSummary {
  const { currentTemplates, currentVariables, packData, storyCount } = args

  const current = new Set(currentVariables.map((v) => v.variableName))
  const incoming = new Set(packData.variables.map((v) => v.variableName))

  return {
    editedTemplates: currentTemplates.filter((t) => !isUntouched(t)).length,
    storyCount,
    addedVariables: [...incoming].filter((name) => !current.has(name)),
    removedVariables: [...current].filter((name) => !incoming.has(name)),
  }
}
