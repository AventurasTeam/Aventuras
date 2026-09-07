/**
 * The `narratorReinforcement` template variable, which the narrative templates branch on to
 * decide how much of the narrator's role and the agency rules the turn message repeats.
 *
 * Unlike `lengthInstruction` this reaches the template as the raw level, not as a formatted
 * sentence, so a pack decides what each level says.
 */

/** The template variable this feeds. A prompt without it cannot honour the setting. */
export const NARRATOR_REINFORCEMENT_VAR = 'narratorReinforcement'

/** `{% comment %}` blocks and `{% # %}` inline comments, which Liquid renders as nothing. */
const LIQUID_COMMENT =
  /\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}|\{%-?\s*#[\s\S]*?%\}/g

/** Tags and output expressions — the only places a template can read a variable. */
const LIQUID_EXPRESSION = /\{%-?[\s\S]*?-?%\}|\{\{-?[\s\S]*?-?\}\}/g

/**
 * Whether a template would honour the setting at all.
 *
 * Any tag rather than a `{{ }}` match: the level is branched on, so it appears in
 * `{% if %}`, `{% case %}` or `{% unless %}` as readily as in an output tag. Comments are
 * removed and prose is ignored, so neither a branch someone commented out nor the variable's
 * name written in the prompt text reports the setting as working.
 */
export function templateUsesNarratorReinforcement(content: string | null | undefined): boolean {
  if (!content) return false
  const active = content.replace(LIQUID_COMMENT, '')
  const reference = new RegExp(`\\b${NARRATOR_REINFORCEMENT_VAR}\\b`)
  return (active.match(LIQUID_EXPRESSION) ?? []).some((expression) => reference.test(expression))
}

/** The two prompts a turn sends, as the bodies that will actually run. */
export interface NarratorPrompts {
  /** The pack's `<template-id>-user` half, which carries the turn message. */
  userTemplate: string | null | undefined
  /** The pack's system half. Ignored when a custom system prompt replaces it. */
  systemTemplate: string | null | undefined
  /** A per-story system prompt, when the story has one. */
  customSystemPrompt: string | null | undefined
}

/**
 * Whether the reinforcement setting can take effect for a story.
 *
 * The turn message comes from the pack whether or not a custom system prompt replaces the
 * system half, so it counts either way — checking the system half alone, as the length
 * guard does, would refuse a setting that works. A pack may carry the reinforcement in the
 * system prompt instead, so a reference in either prompt is enough.
 */
export function narratorReinforcementIsHonoured({
  userTemplate,
  systemTemplate,
  customSystemPrompt,
}: NarratorPrompts): boolean {
  if (templateUsesNarratorReinforcement(userTemplate)) return true
  return templateUsesNarratorReinforcement(customSystemPrompt || systemTemplate)
}
