import { describe, expect, it } from 'vitest'

import { describeContextWindow, type CallRetryError } from '@/lib/ai'
import { t } from '@/lib/i18n'

import {
  assistCanRetry,
  assistFailureDetail,
  assistFailureReason,
  composeKey,
  itemKey,
  mergePages,
  markExisting,
  nameKey,
  type AssistListItem,
  type DedupeKey,
} from './ai-assist-logic'

const item = (name: string): AssistListItem => ({ name, detail: `${name} detail`, payload: null })

// The DedupeKey brand makes an un-normalized key unconstructable through the
// public constructors, which is the point — but itemKey/markExisting still
// normalize defensively, and that behavior needs a way in to stay pinned.
const rawKey = (value: string) => value as DedupeKey

describe('markExisting', () => {
  it('flags a case-insensitive collision with already-imported content', () => {
    const marked = markExisting(
      [item('The Old Empire'), item('Magic wells')],
      [nameKey('the old empire')],
    )
    expect(marked.map((m) => m.exists)).toEqual([true, false])
  })

  it('ignores surrounding whitespace when comparing', () => {
    expect(markExisting([item('  Noir  ')], [nameKey('noir')])[0].exists).toBe(true)
  })

  it('leaves everything importable when nothing exists yet', () => {
    expect(markExisting([item('A'), item('B')], []).every((m) => !m.exists)).toBe(true)
  })

  it('trims the surviving name so the heading matches the dedupe key', () => {
    expect(markExisting([item('  Noir  ')], [])[0].name).toBe('Noir')
  })
})

describe('mergePages', () => {
  it('appends a later page after the earlier one', () => {
    expect(mergePages([item('A')], [item('B')]).map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('drops a duplicate the model re-emitted on Generate more', () => {
    expect(mergePages([item('A')], [item('a'), item('B')]).map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('keeps the first occurrence when a single page repeats itself', () => {
    const merged = mergePages([], [item('A'), item('A')])
    expect(merged).toHaveLength(1)
  })
})

describe('dedupeKey', () => {
  const loc = {
    name: 'Ashfall',
    detail: 'a city',
    dedupeKey: composeKey('location', 'Ashfall'),
    payload: 1,
  }
  const fac = {
    name: 'Ashfall',
    detail: 'a cult',
    dedupeKey: composeKey('faction', 'Ashfall'),
    payload: 2,
  }

  it('mergePages keeps same-named items with distinct dedupeKeys', () => {
    expect(mergePages([loc], [fac])).toHaveLength(2)
  })

  it('mergePages still dedupes on dedupeKey case-insensitively', () => {
    expect(mergePages([loc], [{ ...loc, dedupeKey: rawKey('location:ASHFALL ') }])).toHaveLength(1)
  })

  it('markExisting matches kind-qualified existing keys against dedupeKey', () => {
    const marked = markExisting([loc, fac], [composeKey('faction', 'ashfall')])
    expect(marked[0].exists).toBe(false)
    expect(marked[1].exists).toBe(true)
  })

  it('falls back to the normalized name when dedupeKey is absent (lore path unchanged)', () => {
    const a = { name: 'The Wells', detail: '', payload: 1 }
    expect(mergePages([a], [{ ...a, name: ' the wells' }])).toHaveLength(1)
    expect(markExisting([a], [nameKey('THE WELLS')])[0].exists).toBe(true)
  })

  it('itemKey normalizes whichever identity it uses', () => {
    expect(itemKey({ name: ' The Wells ' })).toBe('the wells')
    expect(itemKey({ name: 'x', dedupeKey: rawKey(' Location:Ashfall ') })).toBe('location:ashfall')
  })
})

describe('composeKey', () => {
  it('normalizes each part, so a padded name still matches a clean key built the same way', () => {
    const paddedRow = {
      name: 'x',
      detail: '',
      dedupeKey: composeKey(' Location ', '  Ashfall  '),
      payload: 1,
    }
    const cleanExistingKey = composeKey('location', 'Ashfall')
    expect(itemKey(paddedRow)).toBe(cleanExistingKey)

    // Naive interpolation — normalizing the JOINED string rather than each part
    // — would leave the padding as interior whitespace and miss this match.
    expect(itemKey({ name: 'x', dedupeKey: rawKey('location:  Ashfall  ') })).not.toBe(
      cleanExistingKey,
    )
  })
})

describe('assistFailureReason', () => {
  // The overlay wraps the reason in "Couldn't generate. {{reason}}.", so none ends in a period.
  describe('a cut-off reply', () => {
    const cut = {
      tier: 'reply-cut-off',
      cause: 'max-output',
      outputTokens: 1024,
      reasoningTokens: null,
      maxOutput: 1024,
      window: null,
      providerId: 'prov_local',
      modelId: 'qwen3-32b',
    } satisfies CallRetryError
    const UNKNOWN =
      'The server stopped the reply at its own limit. Setting a max output on the wizard-assist profile overrides it'

    it("names the wizard-assist profile's max output", () => {
      expect(assistFailureReason(cut)).toBe(
        "The reply was cut off at the wizard-assist profile's 1,024-token max output. Raise it, then try again",
      )
    })

    it("names the model's window when the window was the limit", () => {
      expect(assistFailureReason({ ...cut, cause: 'window', maxOutput: null, window: 65536 })).toBe(
        "The reply was cut off where the prompt and reply filled the model's 65,536-token window",
      )
    })

    it("points at the server's own limit when the call sent no max output", () => {
      expect(assistFailureReason({ ...cut, cause: 'unknown', maxOutput: null })).toBe(UNKNOWN)
      expect(assistFailureReason({ ...cut, maxOutput: null })).toBe(UNKNOWN)
    })

    it('names the max output the server stopped short of', () => {
      expect(assistFailureReason({ ...cut, cause: 'unknown', outputTokens: 300 })).toBe(
        "The server stopped the reply at its own limit, short of the wizard-assist profile's 1,024-token max output",
      )
    })
  })

  it.each([
    ['timeout', 'The request timed out'],
    ['auth', 'The provider refused the request. Check the API key and model access'],
    ['network', "Couldn't reach the provider, or it's busy"],
    ['unknown', 'The provider rejected the request'],
  ] as const)('gives a %s failure a plain sentence, not its diagnostic', (reason, sentence) => {
    expect(assistFailureReason({ tier: 'provider', reason, detail: 'APICallError: nope' })).toBe(
      sentence,
    )
  })

  it('gives a parse failure a plain sentence, not the parser message', () => {
    expect(
      assistFailureReason({ tier: 'parse', detail: 'Unexpected end of JSON input', attempt: 2 }),
    ).toBe("The model's reply wasn't usable")
  })
})

describe('assistFailureReason for a prompt over the context window', () => {
  const LLAMACPP_MESSAGE =
    'request (71834 tokens) exceeds the available context size (65536 tokens), try increasing it'

  const refused = {
    tier: 'context-window',
    detectedBy: 'check',
    estimate: 71_234,
    window: 65_536,
    windowSource: 'configured',
    providerId: 'prov_local',
    modelId: 'llama3.1:70b',
  } satisfies CallRetryError

  const rejected = {
    ...refused,
    detectedBy: 'provider',
    window: null,
    windowSource: 'unknown',
    detail: LLAMACPP_MESSAGE,
  } satisfies CallRetryError

  const REMEDY = "Shorten what you've entered or your guidance, or use a model with a larger window"
  const providerReason = (message: string) =>
    `The provider rejected the prompt. Its message suggests it exceeded the model's context window: “${message}”. ${REMEDY}`

  it("names the rounded estimate and the model's window with its source", () => {
    expect(assistFailureReason(refused)).toBe(
      `The prompt is about 71,300 tokens, over llama3.1:70b's 65,536-token context window (set by you). ${REMEDY}`,
    )
  })

  it('names a detected window as detected', () => {
    expect(assistFailureReason({ ...refused, windowSource: 'detected' })).toBe(
      `The prompt is about 71,300 tokens, over llama3.1:70b's 65,536-token context window (detected). ${REMEDY}`,
    )
  })

  it("quotes the provider's message, hedged, when the provider rejected the prompt", () => {
    expect(assistFailureReason(rejected)).toBe(providerReason(LLAMACPP_MESSAGE))
  })

  it('keeps the provider copy when the window was known as well', () => {
    expect(assistFailureReason({ ...rejected, window: 65_536, windowSource: 'detected' })).toBe(
      providerReason(LLAMACPP_MESSAGE),
    )
  })

  it('quotes the diagnostic line when the provider gave no message', () => {
    const { detail: _detail, ...unquoted } = rejected
    expect(assistFailureReason(unquoted)).toBe(providerReason(describeContextWindow(unquoted)))
  })

  it('quotes the diagnostic line when the provider message is only whitespace', () => {
    const { detail: _detail, ...unquoted } = rejected
    expect(assistFailureReason({ ...rejected, detail: ' \n\t ' })).toBe(
      providerReason(describeContextWindow(unquoted)),
    )
  })

  it('falls back to a plain sentence for a check failure with no window to print', () => {
    const windowless = {
      ...refused,
      window: null,
      windowSource: 'unknown',
    } satisfies CallRetryError
    expect(assistFailureReason(windowless)).toBe('The provider rejected the request')
  })

  // The overlay wraps the reason in "Couldn't generate. {{reason}}.": one closing period.
  it("ends on the failure template's one period", () => {
    expect(t('wizard:aiAssist.failure', { reason: assistFailureReason(refused) })).toBe(
      `Couldn't generate. The prompt is about 71,300 tokens, over llama3.1:70b's 65,536-token context window (set by you). ${REMEDY}.`,
    )
    expect(t('wizard:aiAssist.failure', { reason: assistFailureReason(rejected) })).toBe(
      `Couldn't generate. ${providerReason(LLAMACPP_MESSAGE)}.`,
    )
  })
})

describe('assistFailureDetail', () => {
  it("keeps a provider failure's own line for the disclosure", () => {
    expect(
      assistFailureDetail({ tier: 'provider', reason: 'unknown', detail: 'APICallError: nope' }),
    ).toBe('APICallError: nope')
  })

  it("keeps a parse failure's message", () => {
    expect(assistFailureDetail({ tier: 'parse', detail: 'bad json', attempt: 2 })).toBe('bad json')
  })

  it('has nothing to disclose for a failure with no line of its own', () => {
    expect(assistFailureDetail({ tier: 'provider', reason: 'timeout' })).toBeUndefined()
  })

  it('has nothing to disclose where the sentence is already the whole story', () => {
    const refused = {
      tier: 'context-window',
      detectedBy: 'check',
      estimate: 71_234,
      window: 65_536,
      windowSource: 'configured',
      providerId: 'prov_local',
      modelId: 'm',
    } satisfies CallRetryError
    expect(assistFailureDetail(refused)).toBeUndefined()
  })
})

describe('assistCanRetry', () => {
  const windowFailure = {
    tier: 'context-window',
    detectedBy: 'check',
    estimate: 2,
    window: 1,
    windowSource: 'configured',
    providerId: 'p',
    modelId: 'm',
  } satisfies CallRetryError

  // The overlay offers no way to change the prompt, so the same call refuses the same way.
  it.each([
    ['a check refusal', windowFailure],
    ['a provider rejection', { ...windowFailure, detectedBy: 'provider' as const }],
  ])('offers no retry after %s', (_label, error) => {
    expect(assistCanRetry(error)).toBe(false)
  })

  it('offers a retry after anything else', () => {
    expect(assistCanRetry({ tier: 'provider', reason: 'timeout' })).toBe(true)
    expect(assistCanRetry({ tier: 'parse', detail: 'x', attempt: 2 })).toBe(true)
  })
})
