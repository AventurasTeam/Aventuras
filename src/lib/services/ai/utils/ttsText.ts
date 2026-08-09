/**
 * Turning a story entry into the segments the TTS pipeline speaks.
 *
 * Kept out of the component that used to hold it so the two order-sensitive
 * decisions below can be tested: neither is obvious from reading the call site,
 * and both are silent when wrong.
 */

import type { TTSSanitizeOptions } from '$lib/utils/htmlSanitize'
import { segmentDialogue } from '$lib/utils/dialogue'
import { escapeRegex } from '$lib/utils/text'
import type { TTSSegment } from './TTSService'

export interface TTSTextSettings {
  excludedCharacters: string
  removeHtmlTags: boolean
  removeAllHtmlContent: boolean
  htmlTagsToRemoveContent: string
}

/**
 * How the entry's markup should be stripped before it is spoken.
 *
 * Visual Prose entries force tag removal regardless of the user's setting. In that
 * mode the stored content is machine-generated HTML — wrappers, classes and a
 * `<style>` block — and `removeHtmlTags` defaults to false, so leaving it to the
 * toggle means the reader hears markup read aloud. That default was never a
 * preference about generated HTML; it is about the occasional inline tag a user
 * writes in a markdown story, which is what the toggle still governs there.
 *
 * Dual-voice narration additionally depends on this: quotes inside attributes
 * (`class="scene-a3f"`) and inside CSS would otherwise be read as dialogue and
 * spoken in the character voice.
 */
export function resolveTTSSanitizeOptions(
  settings: TTSTextSettings,
  visualProseMode: boolean,
): TTSSanitizeOptions {
  return {
    removeTags: settings.removeHtmlTags || visualProseMode,
    removeAllTagContent: settings.removeAllHtmlContent,
    htmlTagsToRemoveContent: settings.htmlTagsToRemoveContent.replace(/\s+/g, '').split(','),
  }
}

/**
 * Drop the characters the user does not want pronounced.
 *
 * This is also how quotes are silenced: adding `"` to the excluded characters works
 * because this runs *after* segmentation. Run before it, it would delete the very
 * marks the segmentation reads and collapse every story back to a single voice —
 * silently, since the audio would still play.
 */
export function stripExcludedCharacters(text: string, excludedCharacters: string): string {
  const chars = excludedCharacters.replace(/\s+/g, '').split(',').filter(Boolean)

  if (chars.length === 0) return text

  return text.replace(new RegExp(`[${chars.map(escapeRegex).join('')}]`, 'g'), '')
}

/**
 * Whether a provider can meaningfully speak two voices.
 *
 * Google Translate TTS takes a *language* code where the others take a voice, so a
 * second one there would read the dialogue in another language. Exported as one
 * predicate because the settings UI (which hides the control) and the playback path
 * (which ignores the setting) must never disagree about it.
 */
export function supportsDialogueVoice(provider: string): boolean {
  return provider !== 'google'
}

/** The dialogue voice actually in force, or undefined for single-voice playback. */
export function resolveDialogueVoice(settings: {
  provider: string
  dialogueVoiceEnabled: boolean
  dialogueVoice: string
}): string | undefined {
  if (!settings.dialogueVoiceEnabled) return undefined
  if (!supportsDialogueVoice(settings.provider)) return undefined
  // Enabled but never chosen: fall back to one voice rather than failing playback.
  return settings.dialogueVoice || undefined
}

export interface TTSSegmentOptions {
  narratorVoice: string
  /** When set, quoted speech is spoken in this voice instead of the narrator's. */
  dialogueVoice?: string
  excludedCharacters: string
}

/** Anything a voice could actually pronounce: a letter or a digit, in any script. */
const SPEAKABLE = /[\p{L}\p{N}]/u

/**
 * Split already-sanitized text into the voiced segments to speak.
 *
 * Two kinds of segment never become a request of their own, because a request that
 * says nothing still costs a round trip — and, on a strict endpoint, fails outright,
 * taking the whole entry's playback down with it after its retries:
 *
 * - whitespace-only, dropped (`segmentDialogue` is deliberately lossless, so trimming
 *   is this function's job);
 * - punctuation-only, folded into the segment before it. Splitting on quotes strands
 *   the sentence's own full stop outside them — `"…an option". "This…"` leaves a
 *   narrator segment holding just `.` — and folding it back also lets the previous
 *   line finish on a falling intonation instead of stopping mid-air. With nothing
 *   before it there is nothing to fold into, so it is dropped.
 */
export function prepareTTSSegments(text: string, options: TTSSegmentOptions): TTSSegment[] {
  const { narratorVoice, dialogueVoice, excludedCharacters } = options
  if (!text) return []

  const parts = dialogueVoice ? segmentDialogue(text) : [{ text, isDialogue: false as const }]

  const segments: TTSSegment[] = []
  for (const part of parts) {
    const spoken = stripExcludedCharacters(part.text, excludedCharacters).trim()
    if (!spoken) continue

    if (!SPEAKABLE.test(spoken)) {
      const previous = segments.at(-1)
      // No space: these are marks that belong against the preceding word.
      if (previous) previous.text += spoken
      continue
    }

    segments.push({
      text: spoken,
      voice: part.isDialogue && dialogueVoice ? dialogueVoice : narratorVoice,
    })
  }

  return segments
}
