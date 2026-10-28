import { refsResolve } from './checks'
import type { EvalWindow } from './fixture'
import { ambush } from './windows/ambush'
import { defection } from './windows/defection'
import { learning } from './windows/learning'
import { namedrops } from './windows/namedrops'
import { recounted } from './windows/recounted'
import { reveal } from './windows/reveal'

export type { Check, EvalWindow } from './fixture'
export { renderWindow } from './render'

// The evaluation set the classifier prompt is tuned against (followups.md → Classifier prompt:
// interface and structure). Run it with PROBE_EVAL on the parse probe. Each window also scores
// placeholder use against its own rows.
export const EVAL_WINDOWS: readonly EvalWindow[] = [
  ambush,
  recounted,
  reveal,
  defection,
  learning,
  namedrops,
].map((w) => ({ ...w, checks: [...w.checks, refsResolve(w)] }))
