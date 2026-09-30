import { conjugateThirdPersonPresent } from './conjugate'

export type ComposerMode = 'do' | 'say' | 'think' | 'free'
export type ComposerWrapPov = 'first' | 'third'

export type WrapOptions = {
  mode: ComposerMode
  pov: ComposerWrapPov
  leadName: string | null
}

function ensureTrailingPeriod(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function capitalizeFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1)
}

function conjugateFirstWord(text: string): string {
  const [first, ...rest] = text.split(' ')
  if (!first) return text
  return [conjugateThirdPersonPresent(first), ...rest].join(' ')
}

function wrapSubject(pov: ComposerWrapPov, leadName: string | null): string | null {
  return pov === 'first' ? 'I' : leadName
}

/** The first-person wrap says "I" and needs no lead; any other wrap names the lead. */
export function wrapHasSubject(pov: ComposerWrapPov, leadName: string | null): boolean {
  return wrapSubject(pov, leadName) != null
}

export function wrapComposerText(rawText: string, opts: WrapOptions): string {
  const { mode, pov, leadName } = opts
  const subject = wrapSubject(pov, leadName)
  // A caller sending a non-free mode with no subject to wrap around is a bug upstream —
  // fail safe to the raw text rather than emit e.g. " draw my blade.".
  if (mode === 'free' || subject == null) return rawText

  const text = rawText.trim()
  if (mode === 'do') {
    const body = pov === 'first' ? text : conjugateFirstWord(text)
    return ensureTrailingPeriod(`${subject} ${body}`)
  }
  if (mode === 'say') return `"${capitalizeFirst(text)}" ${subject} said.`
  // mode === 'think'
  return `*${text}* ${subject} thought.`
}

export type { WrapOptions as ComposerWrapOptions }
