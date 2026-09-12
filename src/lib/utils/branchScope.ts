/**
 * How a story branch is named when it is used as a map or set key.
 *
 * The lore-session lock and the background-task counter are separate locks and stay
 * separate; what must not diverge is what "the main branch" is spelled as, since a writer
 * and a reader that disagree both report the branch idle. A leaf module, so a rune store
 * and a plain service can share it.
 */
export function branchScopeKey(storyId: string, branchId: string | null): string {
  return `${storyId}:${branchId ?? 'main'}`
}

/** A story and one of its branches. `null` is the main branch. */
export interface BranchScope {
  storyId: string
  branchId: string | null
}

/**
 * Whether two scopes name the same branch of the same story.
 *
 * Normalises the branch on both sides. A missing branch reaches this as `null` from the store
 * and as `undefined` from anything spread out of a partial record, and a comparison that tells
 * those apart reports one branch as two — the same divergence `branchScopeKey` exists to stop.
 */
export function sameBranchScope(a: BranchScope, b: BranchScope): boolean {
  return a.storyId === b.storyId && (a.branchId ?? null) === (b.branchId ?? null)
}
