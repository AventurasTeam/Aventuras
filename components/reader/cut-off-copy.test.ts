import { describe, expect, it } from 'vitest'

import type { ReplyCutOffFailure } from '@/lib/ai'

import {
  closeCutOffContent,
  cutOffNoticeText,
  offersProfileFix,
  passCutOffContent,
  turnCutOffContent,
} from './cut-off-copy'

const AT_MAX_OUTPUT: ReplyCutOffFailure = {
  cause: 'max-output',
  outputTokens: 4100,
  reasoningTokens: null,
  maxOutput: 4096,
  window: null,
  providerId: 'prov_local',
  modelId: 'qwen3-32b',
  fromOverride: false,
}

const AT_WINDOW: ReplyCutOffFailure = {
  ...AT_MAX_OUTPUT,
  cause: 'window',
  outputTokens: 1200,
  maxOutput: null,
  window: 65536,
}

const AT_SERVER_DEFAULT: ReplyCutOffFailure = {
  ...AT_MAX_OUTPUT,
  cause: 'unknown',
  outputTokens: 2048,
  maxOutput: null,
}

// generation-pipeline.md → Cut-off replies: the call sent a max output the reply fell short of.
const SHORT_OF_MAX_OUTPUT: ReplyCutOffFailure = {
  ...AT_MAX_OUTPUT,
  cause: 'unknown',
  outputTokens: 300,
}

const TURN_MAX_OUTPUT =
  "The reply was cut off at the narrative profile's 4,096-token max output before any story text. Raise the max output, then Retry."
const TURN_UNKNOWN =
  'The server stopped the reply at its own limit before any story text. Setting a max output on the profile overrides it.'
const PASS_UNKNOWN =
  "Memory update failed, so your turn didn't start. The server stopped the update's reply at its own limit. Setting a max output on the classifier profile overrides it."
const TURN_SHORT =
  "The server stopped the reply at its own limit before any story text, short of the narrative profile's 4,096-token max output."
const NOTICE_UNKNOWN =
  'The server stopped the reply at its own limit. Setting a max output on the profile overrides it.'

describe('turnCutOffContent', () => {
  it("names the narrative profile's max output, with the number formatted", () => {
    expect(turnCutOffContent(AT_MAX_OUTPUT)).toBe(TURN_MAX_OUTPUT)
  })

  it('says how much of the limit reasoning used when the provider counted it', () => {
    expect(turnCutOffContent({ ...AT_MAX_OUTPUT, reasoningTokens: 3900 })).toBe(
      "The reply was cut off at the narrative profile's 4,096-token max output before any story text; reasoning used 3,900 of them. Raise the max output, then Retry.",
    )
  })

  // The OpenAI-compatible provider reports a missing reasoning count as 0.
  it('drops the reasoning clause for a count of 0', () => {
    expect(turnCutOffContent({ ...AT_MAX_OUTPUT, reasoningTokens: 0 })).toBe(TURN_MAX_OUTPUT)
  })

  it("names the model's window when the window was the limit", () => {
    expect(turnCutOffContent(AT_WINDOW)).toBe(
      "The reply was cut off where the prompt and reply filled the model's 65,536-token window, before any story text.",
    )
  })

  it("points at the server's own limit when neither limit was reached", () => {
    expect(turnCutOffContent(AT_SERVER_DEFAULT)).toBe(TURN_UNKNOWN)
  })

  it('reads as the server limit when the limit its cause names is missing', () => {
    expect(turnCutOffContent({ ...AT_MAX_OUTPUT, maxOutput: null })).toBe(TURN_UNKNOWN)
    expect(turnCutOffContent({ ...AT_WINDOW, window: null })).toBe(TURN_UNKNOWN)
  })

  it('names the max output the server stopped short of, without telling the user to set one', () => {
    expect(turnCutOffContent(SHORT_OF_MAX_OUTPUT)).toBe(TURN_SHORT)
    expect(turnCutOffContent({ ...SHORT_OF_MAX_OUTPUT, reasoningTokens: 280 })).toBe(TURN_SHORT)
    expect(turnCutOffContent({ ...SHORT_OF_MAX_OUTPUT, cause: 'window' })).toBe(TURN_SHORT)
  })
})

describe('passCutOffContent', () => {
  const PASS_MAX_OUTPUT =
    "Memory update failed, so your turn didn't start. The update's reply was cut off at the classifier profile's 1,024-token max output. Raise it, then Retry."
  const atClassifierLimit = { ...AT_MAX_OUTPUT, outputTokens: 1030, maxOutput: 1024 }

  it("names the classifier profile's max output", () => {
    expect(passCutOffContent(atClassifierLimit)).toBe(PASS_MAX_OUTPUT)
  })

  it('has no reasoning clause', () => {
    expect(passCutOffContent({ ...atClassifierLimit, reasoningTokens: 900 })).toBe(PASS_MAX_OUTPUT)
  })

  it("names the model's window when the window was the limit", () => {
    expect(passCutOffContent(AT_WINDOW)).toBe(
      "Memory update failed, so your turn didn't start. The update's reply was cut off where the prompt and reply filled the model's 65,536-token window.",
    )
  })

  it("points at the server's own limit otherwise", () => {
    expect(passCutOffContent(AT_SERVER_DEFAULT)).toBe(PASS_UNKNOWN)
    expect(passCutOffContent({ ...AT_MAX_OUTPUT, maxOutput: null })).toBe(PASS_UNKNOWN)
    expect(passCutOffContent({ ...AT_WINDOW, window: null })).toBe(PASS_UNKNOWN)
  })

  it('names the max output the server stopped short of', () => {
    expect(passCutOffContent({ ...SHORT_OF_MAX_OUTPUT, maxOutput: 1024 })).toBe(
      "Memory update failed, so your turn didn't start. The server stopped the update's reply at its own limit, short of the classifier profile's 1,024-token max output.",
    )
  })
})

describe('closeCutOffContent', () => {
  const CLOSE_MAX_OUTPUT =
    "Chapter close failed, so your turn didn't start. The close's reply was cut off at the lore management profile's 2,048-token max output. Raise it, then Retry."
  const atCloseLimit = { ...AT_MAX_OUTPUT, outputTokens: 2050, maxOutput: 2048 }

  it("names the lore management profile's max output", () => {
    expect(closeCutOffContent(atCloseLimit)).toBe(CLOSE_MAX_OUTPUT)
  })

  it('has no reasoning clause', () => {
    expect(closeCutOffContent({ ...atCloseLimit, reasoningTokens: 900 })).toBe(CLOSE_MAX_OUTPUT)
  })

  it("names the model's window when the window was the limit", () => {
    expect(closeCutOffContent(AT_WINDOW)).toBe(
      "Chapter close failed, so your turn didn't start. The close's reply was cut off where the prompt and reply filled the model's 65,536-token window.",
    )
  })

  it("points at the server's own limit otherwise", () => {
    const unknown =
      "Chapter close failed, so your turn didn't start. The server stopped the close's reply at its own limit. Setting a max output on the lore management profile overrides it."
    expect(closeCutOffContent(AT_SERVER_DEFAULT)).toBe(unknown)
    expect(closeCutOffContent({ ...AT_WINDOW, window: null })).toBe(unknown)
  })

  it('names the max output the server stopped short of', () => {
    expect(closeCutOffContent({ ...SHORT_OF_MAX_OUTPUT, maxOutput: 2048 })).toBe(
      "Chapter close failed, so your turn didn't start. The server stopped the close's reply at its own limit, short of the lore management profile's 2,048-token max output.",
    )
  })

  // The pass's words name the classifier profile, which would send the user to the wrong one.
  it('never borrows the pass copy', () => {
    expect(closeCutOffContent(atCloseLimit)).not.toBe(passCutOffContent(atCloseLimit))
  })
})

describe('cutOffNoticeText', () => {
  it("names the narrative profile's max output", () => {
    expect(cutOffNoticeText({ cause: 'max-output', outputTokens: 4100, limit: 4096 })).toBe(
      "Cut off at the narrative profile's 4,096-token max output.",
    )
  })

  it("names the model's window", () => {
    expect(cutOffNoticeText({ cause: 'window', outputTokens: 1200, limit: 65536 })).toBe(
      "Cut off where the prompt and reply filled the model's 65,536-token window.",
    )
  })

  it("points at the server's own limit for an unknown cause", () => {
    expect(cutOffNoticeText({ cause: 'unknown', outputTokens: 2048 })).toBe(NOTICE_UNKNOWN)
  })

  it('names the max output the server stopped short of', () => {
    expect(cutOffNoticeText({ cause: 'unknown', outputTokens: 300, maxOutput: 4096 })).toBe(
      "The server stopped the reply at its own limit, short of the narrative profile's 4,096-token max output.",
    )
  })
})

describe('cutOffNoticeText, a reply that ended early', () => {
  it('says the reply may be incomplete, not that a limit stopped it', () => {
    expect(cutOffNoticeText({ cause: 'interrupted', outputTokens: 300 })).toBe(
      'The provider ended this reply without saying it had finished, so it may be incomplete.',
    )
  })

  it('names the content filter', () => {
    expect(cutOffNoticeText({ cause: 'content-filter' })).toBe(
      "The provider's content filter stopped this reply.",
    )
  })
})

describe('offersProfileFix', () => {
  it.each(['max-output', 'unknown', undefined])('offers the profile for cause %s', (cause) => {
    expect(offersProfileFix(cause)).toBe(true)
  })

  it.each(['window', 'interrupted', 'content-filter'])('offers no profile for %s', (cause) => {
    expect(offersProfileFix(cause)).toBe(false)
  })
})

// generation-pipeline.md → Cut-off replies → Whose setting it was: a call on the story's override
// names the override's limit, on every surface that names one.
describe("the copy for a cut under the story's override", () => {
  const OVER = { fromOverride: true } as const

  it('names the narrative override on the turn entry, each cause that names a setting', () => {
    expect(turnCutOffContent({ ...AT_MAX_OUTPUT, ...OVER })).toBe(
      "The reply was cut off at the 4,096-token max output of this story's narrative override before any story text. Raise the max output, then Retry.",
    )
    expect(turnCutOffContent({ ...AT_MAX_OUTPUT, ...OVER, reasoningTokens: 3900 })).toBe(
      "The reply was cut off at the 4,096-token max output of this story's narrative override before any story text; reasoning used 3,900 of them. Raise the max output, then Retry.",
    )
    expect(turnCutOffContent({ ...AT_SERVER_DEFAULT, ...OVER })).toBe(
      "The server stopped the reply at its own limit before any story text. Setting a max output on this story's narrative override replaces it.",
    )
    expect(turnCutOffContent({ ...SHORT_OF_MAX_OUTPUT, ...OVER })).toBe(
      "The server stopped the reply at its own limit before any story text, short of the 4,096-token max output of this story's narrative override.",
    )
  })

  it('names the classifier override on a pass entry', () => {
    expect(passCutOffContent({ ...AT_MAX_OUTPUT, ...OVER, maxOutput: 1024 })).toBe(
      "Memory update failed, so your turn didn't start. The update's reply was cut off at the 1,024-token max output of this story's classifier override. Raise it, then Retry.",
    )
    expect(passCutOffContent({ ...AT_SERVER_DEFAULT, ...OVER })).toBe(
      "Memory update failed, so your turn didn't start. The server stopped the update's reply at its own limit. Setting a max output on this story's classifier override replaces it.",
    )
    expect(passCutOffContent({ ...SHORT_OF_MAX_OUTPUT, ...OVER, maxOutput: 1024 })).toBe(
      "Memory update failed, so your turn didn't start. The server stopped the update's reply at its own limit, short of the 1,024-token max output of this story's classifier override.",
    )
  })

  it('names the lore management override on a close entry', () => {
    expect(closeCutOffContent({ ...AT_MAX_OUTPUT, ...OVER, maxOutput: 2048 })).toBe(
      "Chapter close failed, so your turn didn't start. The close's reply was cut off at the 2,048-token max output of this story's lore management override. Raise it, then Retry.",
    )
    expect(closeCutOffContent({ ...AT_SERVER_DEFAULT, ...OVER })).toBe(
      "Chapter close failed, so your turn didn't start. The server stopped the close's reply at its own limit. Setting a max output on this story's lore management override replaces it.",
    )
    expect(closeCutOffContent({ ...SHORT_OF_MAX_OUTPUT, ...OVER, maxOutput: 2048 })).toBe(
      "Chapter close failed, so your turn didn't start. The server stopped the close's reply at its own limit, short of the 2,048-token max output of this story's lore management override.",
    )
  })

  it('names the narrative override on the card notice, for each cause the mark keeps it on', () => {
    expect(cutOffNoticeText({ cause: 'max-output', limit: 4096, ...OVER })).toBe(
      "Cut off at the 4,096-token max output of this story's narrative override.",
    )
    expect(cutOffNoticeText({ cause: 'unknown', ...OVER })).toBe(
      "The server stopped the reply at its own limit. Setting a max output on this story's narrative override replaces it.",
    )
    expect(cutOffNoticeText({ cause: 'unknown', maxOutput: 4096, ...OVER })).toBe(
      "The server stopped the reply at its own limit, short of the 4,096-token max output of this story's narrative override.",
    )
  })

  // The window is the model's, not a setting either owner holds.
  it('words a window cut the same on every surface', () => {
    expect(turnCutOffContent({ ...AT_WINDOW, ...OVER })).toBe(turnCutOffContent(AT_WINDOW))
    expect(passCutOffContent({ ...AT_WINDOW, ...OVER })).toBe(passCutOffContent(AT_WINDOW))
    expect(closeCutOffContent({ ...AT_WINDOW, ...OVER })).toBe(closeCutOffContent(AT_WINDOW))
    const mark = { cause: 'window', limit: 65536 } as const
    expect(cutOffNoticeText({ ...mark, ...OVER })).toBe(cutOffNoticeText(mark))
  })
})
