import { describe, expect, it } from 'vitest'

import { describeContextWindow, type ContextWindowFailure } from '@/lib/ai'

import {
  capabilityHintContent,
  passContextWindowContent,
  turnContextWindowContent,
  windowSourceLabel,
} from './context-window-copy'

const LLAMACPP_MESSAGE =
  'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'

const CHECKED: ContextWindowFailure = {
  detectedBy: 'check',
  estimate: 71_234,
  window: 65_536,
  windowSource: 'configured',
  providerId: 'prov_local',
  modelId: 'llama3.1:70b',
}

// An overflow on a model with no known window: nothing was checked before the send.
const REJECTED_UNQUOTED: ContextWindowFailure = {
  detectedBy: 'provider',
  estimate: 71_234,
  window: null,
  windowSource: 'unknown',
  providerId: 'prov_local',
  modelId: 'llama3.1:70b',
}

const REJECTED: ContextWindowFailure = { ...REJECTED_UNQUOTED, detail: LLAMACPP_MESSAGE }

// The check writes no failure without a window, but the type allows one.
const CHECKED_WINDOWLESS: ContextWindowFailure = {
  ...CHECKED,
  window: null,
  windowSource: 'unknown',
}

const TURN_REMEDIES =
  'Shorten the prompt in Story Settings (memory budgets, history buffer), raise the window if the model allows more, or switch to a model with a larger one.'
const PASS_REMEDIES =
  'Raise the window if the model allows more, or switch the classifier to a model with a larger one.'
const PASS_PREFIX = "Memory update failed, so your turn didn't start."

const turnProviderCopy = (message: string) =>
  `The provider rejected the prompt. Its message suggests it exceeded the model's context window: “${message}”. Our estimate: about 71,300 tokens. ${TURN_REMEDIES}`
const passProviderCopy = (message: string) =>
  `${PASS_PREFIX} The provider rejected the update's prompt; its message suggests it exceeded the model's context window: “${message}”. Our estimate: about 71,300 tokens. ${PASS_REMEDIES}`

describe('turnContextWindowContent', () => {
  it("names the rounded estimate and the model's window with its source", () => {
    expect(turnContextWindowContent(CHECKED)).toBe(
      `This prompt is about 71,300 tokens; llama3.1:70b's context window is 65,536 (set by you). Nothing was sent. ${TURN_REMEDIES}`,
    )
  })

  it('prints an estimate under 1,000 exactly, and a detected window as detected', () => {
    expect(
      turnContextWindowContent({
        ...CHECKED,
        estimate: 999,
        window: 512,
        windowSource: 'detected',
      }),
    ).toBe(
      `This prompt is about 999 tokens; llama3.1:70b's context window is 512 (detected). Nothing was sent. ${TURN_REMEDIES}`,
    )
  })

  it("quotes the provider's message and the estimate when the provider rejected the prompt", () => {
    expect(turnContextWindowContent(REJECTED)).toBe(turnProviderCopy(LLAMACPP_MESSAGE))
  })

  // The provider's message is the evidence; a known window must not swap in the check's numbers.
  it('keeps the provider copy when the window was known as well', () => {
    expect(
      turnContextWindowContent({ ...REJECTED, window: 65_536, windowSource: 'detected' }),
    ).toBe(turnProviderCopy(LLAMACPP_MESSAGE))
  })

  it('quotes the diagnostic line when the provider gave no message', () => {
    expect(turnContextWindowContent(REJECTED_UNQUOTED)).toBe(
      turnProviderCopy(describeContextWindow(REJECTED_UNQUOTED)),
    )
  })

  it('quotes the diagnostic line when the provider message is blank', () => {
    expect(turnContextWindowContent({ ...REJECTED_UNQUOTED, detail: '  ' })).toBe(
      turnProviderCopy(describeContextWindow(REJECTED_UNQUOTED)),
    )
  })

  it('falls back to the generic turn copy for a check failure with no window to print', () => {
    expect(turnContextWindowContent(CHECKED_WINDOWLESS)).toBe(
      'Generation failed. Retry to try again.',
    )
  })
})

describe('passContextWindowContent', () => {
  it("names the update's prompt and the model's window, with the classifier's remedies", () => {
    expect(
      passContextWindowContent({
        ...CHECKED,
        estimate: 41_812,
        window: 32_768,
        windowSource: 'detected',
        modelId: 'qwen2.5:14b',
      }),
    ).toBe(
      `${PASS_PREFIX} The update's prompt is about 41,900 tokens; qwen2.5:14b's context window is 32,768 (detected). ${PASS_REMEDIES}`,
    )
  })

  it("quotes the provider's message for a rejected pass prompt", () => {
    expect(passContextWindowContent(REJECTED)).toBe(passProviderCopy(LLAMACPP_MESSAGE))
  })

  it('quotes the diagnostic line when the provider gave no message', () => {
    expect(passContextWindowContent(REJECTED_UNQUOTED)).toBe(
      passProviderCopy(describeContextWindow(REJECTED_UNQUOTED)),
    )
  })

  it('falls back to the generic pass copy for a check failure with no window to print', () => {
    expect(passContextWindowContent(CHECKED_WINDOWLESS)).toBe(
      `${PASS_PREFIX} Retry it, or send again.`,
    )
  })
})

describe('capabilityHintContent', () => {
  it.each([
    [
      { capability: 'reasoning', matched: 'thinking' },
      "The provider rejected the request. Its message mentions `thinking`. That can mean this model doesn't support reasoning: check the profile's thinking setting and the model's 🧠 badge. The provider may also have rejected the request for another reason.",
    ],
    [
      { capability: 'structuredOutput', matched: 'json_schema' },
      "The provider rejected the request. Its message mentions `json_schema`. That can mean this model doesn't support structured output: check the profile's structured-output setting and the model's badge. The provider may also have rejected the request for another reason.",
    ],
  ] as const)('hedges a turn hint for %o', (hint, expected) => {
    expect(capabilityHintContent(hint, 'turn')).toBe(expected)
  })

  it.each([
    [
      { capability: 'reasoning', matched: 'budget_tokens' },
      "Memory update failed, so your turn didn't start. The provider rejected the update's request. Its message mentions `budget_tokens`. That can mean this model doesn't support reasoning: check the profile's thinking setting and the model's 🧠 badge. The provider may also have rejected the request for another reason.",
    ],
    [
      { capability: 'structuredOutput', matched: 'response_format' },
      "Memory update failed, so your turn didn't start. The provider rejected the update's request. Its message mentions `response_format`. That can mean this model doesn't support structured output: check the profile's structured-output setting and the model's badge. The provider may also have rejected the request for another reason.",
    ],
  ] as const)("hedges a pass hint in the pass's own words for %o", (hint, expected) => {
    expect(capabilityHintContent(hint, 'pass')).toBe(expected)
  })
})

describe('windowSourceLabel', () => {
  it.each([
    ['configured', 'set by you'],
    ['detected', 'detected'],
  ] as const)('labels a %s window "%s"', (source, label) => {
    expect(windowSourceLabel(source)).toBe(label)
  })
})
