import { conjugateThirdPersonPresent } from './conjugate'

export type ComposerMode = 'do' | 'say' | 'think' | 'free'
export type ComposerWrapPov = 'first' | 'third'

export type WrapOptions = {
  mode: ComposerMode
  pov: ComposerWrapPov
  leadName: string
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

export function wrapComposerText(rawText: string, opts: WrapOptions): string {
  const { mode, pov, leadName } = opts
  if (mode === 'free') return rawText

  const text = rawText.trim()
  if (mode === 'do') {
    const body = pov === 'first' ? text : conjugateFirstWord(text)
    const subject = pov === 'first' ? 'I' : leadName
    return ensureTrailingPeriod(`${subject} ${body}`)
  }
  if (mode === 'say') {
    const subject = pov === 'first' ? 'I' : leadName
    return `"${capitalizeFirst(text)}" ${subject} said.`
  }
  // mode === 'think'
  const subject = pov === 'first' ? 'I' : leadName
  return `*${text}* ${subject} thought.`
}

export type { WrapOptions as ComposerWrapOptions }
