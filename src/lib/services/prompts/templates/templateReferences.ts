/**
 * Whether a story setting that reaches the narrator templates as a raw value can take effect:
 * a setting does nothing unless one of the prompts that will actually run reads its variable.
 */

import { templateEngine } from '$lib/services/templates/engine'

/**
 * Whether a template could read the variable. A template that does not parse counts as reading
 * it, so a check that cannot tell leaves the setting enabled.
 */
export function templateReferencesVariable(
  content: string | null | undefined,
  name: string,
): boolean {
  if (!content) return false
  return templateEngine.readVariables(content)?.includes(name) ?? true
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
 * Whether a setting read through `name` can take effect for a story.
 *
 * The turn message comes from the pack whether or not a custom system prompt replaces the
 * system half, so it counts either way. A pack may carry the setting in either prompt, so a
 * reference in either is enough.
 */
export function variableIsHonoured(
  name: string,
  { userTemplate, systemTemplate, customSystemPrompt }: NarratorPrompts,
): boolean {
  if (templateReferencesVariable(userTemplate, name)) return true
  return templateReferencesVariable(customSystemPrompt || systemTemplate, name)
}
