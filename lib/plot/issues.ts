/** Draft-schema issue messages; each is a `plot:validation.*` key the panes translate. */
export const PLOT_ISSUE = {
  titleRequired: 'titleRequired',
  timeAnchorExclusive: 'timeAnchorExclusive',
  duplicateEntity: 'duplicateEntity',
  duplicateCharacter: 'duplicateCharacter',
  entityRequired: 'entityRequired',
  characterRequired: 'characterRequired',
  decayRange: 'decayRange',
} as const

export type PlotIssue = (typeof PLOT_ISSUE)[keyof typeof PLOT_ISSUE]

const ISSUES: readonly string[] = Object.values(PLOT_ISSUE)

export function isPlotIssue(message: string): message is PlotIssue {
  return ISSUES.includes(message)
}
