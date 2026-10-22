import { isDraftEmpty } from './composer-draft'

/**
 * Where a Send's text goes when its pass refused it (reader-composer.md → Custody of the turn's
 * text): back to the composer, or onto the entry, which Dismiss hands back from.
 */
export type PassFailureCustody = 'composer' | 'entry'

type PassFailureCustodyRead = { stillOnBranch: boolean; draftEmpty: boolean }

export function readPassFailureCustody(args: {
  stillOnBranch: boolean
  composer: { getDraft(): { text: string } } | null
}): PassFailureCustodyRead {
  return {
    stillOnBranch: args.stillOnBranch,
    // An unmounted composer can't take the text back, so the entry keeps it.
    draftEmpty: args.composer != null && isDraftEmpty(args.composer.getDraft()),
  }
}

export function planPassFailureCustody(args: {
  held: boolean
  stillOnBranch: boolean
  draftEmpty: boolean
}): PassFailureCustody {
  // A held entry advises a restart, which composer input doesn't survive.
  if (args.held) return 'entry'
  return args.stillOnBranch && args.draftEmpty ? 'composer' : 'entry'
}

/**
 * Writes the entry before the text returns, so a failed write leaves it in the caller's hands and
 * never in two places; a composer that stopped being free during the write gets it onto the entry.
 */
export async function settlePassFailureCustody(deps: {
  held: boolean
  custodyNow: () => PassFailureCustodyRead
  write: (withSubmission: boolean) => Promise<void>
  restoreDraft: () => void
}): Promise<void> {
  if (planPassFailureCustody({ held: deps.held, ...deps.custodyNow() }) === 'entry')
    return deps.write(true)
  await deps.write(false)
  if (planPassFailureCustody({ held: deps.held, ...deps.custodyNow() }) === 'composer')
    deps.restoreDraft()
  else await deps.write(true)
}
