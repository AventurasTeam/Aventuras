import { describe, expect, it } from 'vitest'

import type { ReplyCutOffFailure } from '@/lib/ai'

import {
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

const TURN_MAX_OUTPUT =
  "The reply was cut off at the narrative profile's 4,096-token max output before any story text. Raise the max output, then Retry."
const TURN_UNKNOWN =
  'The server stopped the reply at its own limit before any story text. Setting a max output on the profile overrides it.'
const PASS_UNKNOWN =
  "Memory update failed, so your turn didn't start. The server stopped the update's reply at its own limit. Setting a max output on the classifier profile overrides it."
const NOTICE_UNKNOWN =
  'The server stopped the reply at its own limit. Setting a max output on the profile overrides it.'

describe('turnCutOffContent', () => {
  it("names the narrative profile's max output, with the number formatted", () => {
    expect(turnCutOffContent(AT_MAX_OUTPUT)).toBe(TURN_MAX_OUTPUT)
  })

  it('says how much of the limit reasoning used when the provider counted it', () => {
    expect(turnCutOffContent({ ...AT_MAX_OUTPUT, reasoningTokens: 3900 })).toBe(
      "The reply was cut off at the narrative profile's 4,096-token max output before any story text; reasoning used 3,900 of them. Raise the max output, or lower the thinking budget, then Retry.",
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

  it('reads as the server limit when the mark carries no limit', () => {
    expect(cutOffNoticeText({ cause: 'max-output' })).toBe(NOTICE_UNKNOWN)
    expect(cutOffNoticeText({ cause: 'window' })).toBe(NOTICE_UNKNOWN)
  })
})

describe('offersProfileFix', () => {
  it.each(['max-output', 'unknown', undefined])('offers the profile for cause %s', (cause) => {
    expect(offersProfileFix(cause)).toBe(true)
  })

  it('offers no profile for a window cut-off', () => {
    expect(offersProfileFix('window')).toBe(false)
  })
})
