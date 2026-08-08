/**
 * Seeds for the second Tier 2 pass.
 *
 * The first pass matches candidates against the player's action and the recent story. The
 * second one matches what is left against the *names* of what the first pass found, so an
 * entry nobody named directly still comes in when something that names it did.
 *
 * Names and aliases only, never descriptions: descriptions cross-reference each other by
 * construction, so seeding with them pulls in half a dense lorebook in one step.
 *
 * Shared by `EntryRetrievalService` and `WorldStateInjector`, which run the same two passes
 * over different candidate shapes.
 */

/** Below this a name is too generic to be a seed — it matches by accident, not by meaning. */
const MIN_SEED_LENGTH = 4

/** Escape a seed for use inside a RegExp — names can hold `.`, `(`, `-` and the rest. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `seed` appears in `longer` as a whole word or run of words.
 *
 * Word-bounded, not `includes`: matching downstream is word-bounded too, so `"Iron"` is
 * genuinely covered by `"Iron Mountain"` and dropping it loses nothing, while `"Aria"` is
 * *not* covered by `"Ariadne"` — a word-boundary search for the longer name will never find
 * the shorter one. Plain containment dropped both alike and silently lost the second.
 */
function containsAsWords(longer: string, seed: string): boolean {
  return new RegExp(`(?:^|\\s)${escapeRegExp(seed)}(?:\\s|$)`).test(longer)
}

/**
 * The haystack for the second pass, or `''` when nothing survives the filters.
 *
 * Two filters, both against false positives. Matching is word-boundary based, so a short
 * generic name matches wherever it appears as a word inside a longer one — "Iron" hits
 * "Iron Mountain" every time. So a seed is dropped when it is shorter than
 * `MIN_SEED_LENGTH`, and when another seed contains it *as a word*: there the longer name
 * is the specific one and the shorter only widens the match to what the longer already
 * covers. See `containsAsWords` for why plain containment is the wrong test.
 */
export function secondPassHaystack(names: (string | null | undefined)[]): string {
  const seeds = [...new Set(names.map((n) => n?.trim().toLowerCase()).filter(Boolean) as string[])]
    .filter((n) => n.length >= MIN_SEED_LENGTH)
    .sort((a, b) => b.length - a.length)

  const kept: string[] = []
  for (const seed of seeds) {
    if (kept.some((longer) => containsAsWords(longer, seed))) continue
    kept.push(seed)
  }

  return kept.join(' ')
}
