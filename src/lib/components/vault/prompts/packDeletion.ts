/** Story titles named before the rest are counted, so a long list stays a sentence. */
const NAMED_STORIES = 3

/** What deleting a pack loses, or which stories have to go first. */
export function packDeletionDescription(storyTitles: string[]): string {
  if (storyTitles.length === 0) return 'Its prompts and custom variables will be deleted.'

  const quoted = storyTitles.slice(0, NAMED_STORIES).map((title) => `“${title}”`)
  const rest = storyTitles.length - quoted.length
  const names =
    rest > 0
      ? `${quoted.join(', ')} and ${rest} more ${rest === 1 ? 'story' : 'stories'}`
      : quoted.length === 1
        ? quoted[0]
        : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`

  return storyTitles.length === 1
    ? `${names} uses this pack. Remove it before deleting the pack.`
    : `${names} use this pack. Remove them before deleting the pack.`
}
