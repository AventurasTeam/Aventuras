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
