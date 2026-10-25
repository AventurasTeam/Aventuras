import { wrapComposerText, type ComposerMode, type ComposerWrapPov } from '@/lib/composer-wrap'
import type { SystemFailureMeta } from '@/lib/db'

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

type Submission = NonNullable<SystemFailureMeta['submission']>
type ComposerDraft = { text: string; mode: ComposerMode }

/**
 * A pass entry's Retry committed: the entry goes and Dismiss hands its text back, unless the
 * composer can't take it (occupied, or the user left the branch). Then the entry stays as a notice
 * holding the text, whose own Dismiss hands it back later.
 */
export function planCommittedPassRetry(
  args: { entryHasText: boolean } & PassFailureCustodyRead,
): 'dismiss' | 'keep-notice' {
  if (!args.entryHasText) return 'dismiss'
  return args.stillOnBranch && args.draftEmpty ? 'dismiss' : 'keep-notice'
}

export async function settleCommittedPassRetry(deps: {
  stored: Submission | undefined
  custodyNow: () => PassFailureCustodyRead
  dismiss: () => Promise<void>
  keepNotice: (submission: Submission) => Promise<void>
}): Promise<void> {
  const plan = planCommittedPassRetry({ entryHasText: deps.stored != null, ...deps.custodyNow() })
  if (plan === 'keep-notice' && deps.stored != null) return deps.keepNotice(deps.stored)
  return deps.dismiss()
}

/**
 * A pass-entry Retry's rewrite: a held entry with no text takes the composer's draft, since it
 * advises a restart the draft wouldn't survive. Off the branch, the draft is another branch's.
 */
export function planPassRetryCustody(args: {
  held: boolean
  entryHasText: boolean
  stillOnBranch: boolean
  draftEmpty: boolean
}): 'keep' | 'take-draft' {
  return args.held && !args.entryHasText && args.stillOnBranch && !args.draftEmpty
    ? 'take-draft'
    : 'keep'
}

/** The draft as the composer's Send takes it: Dismiss hands an entry's text back under Free. */
export function draftSubmission(
  draft: ComposerDraft,
  wrap: { modesUsable: boolean; pov: ComposerWrapPov; leadName: string | null },
): Submission {
  const mode = wrap.modesUsable ? draft.mode : 'free'
  return {
    content: wrapComposerText(draft.text, { mode, pov: wrap.pov, leadName: wrap.leadName }),
    composerMode: mode,
  }
}

/**
 * Writes the entry before the composer empties, so a failed write leaves the text in the composer;
 * a draft that changed during the write stays there too, duplicated rather than lost.
 */
export async function settlePassRetryCustody(deps: {
  held: boolean
  stored: Submission | undefined
  stillOnBranch: () => boolean
  draft: () => ComposerDraft | undefined
  toSubmission: (draft: ComposerDraft) => Submission
  write: (submission: Submission | undefined) => Promise<void>
  clearDraft: () => void
}): Promise<void> {
  const draft = deps.draft()
  const plan = planPassRetryCustody({
    held: deps.held,
    entryHasText: deps.stored != null,
    stillOnBranch: deps.stillOnBranch(),
    draftEmpty: isDraftEmpty(draft),
  })
  if (plan === 'keep' || draft == null) return deps.write(deps.stored)
  await deps.write(deps.toSubmission(draft))
  const now = deps.draft()
  if (deps.stillOnBranch() && now?.text === draft.text && now.mode === draft.mode) deps.clearDraft()
}
