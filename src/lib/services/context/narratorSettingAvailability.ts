import {
  narratorSettingReasons,
  type NarratorSettingReasons,
} from '$lib/services/prompts/templates'
import { ContextBuilder } from './context-builder'

export type { NarratorSettingReasons }

/** Resolves the narrator prompts a story on this pack and mode would send, and checks both settings. */
export async function resolveNarratorSettingAvailability(
  packId: string,
  mode: string | undefined,
  customSystemPrompt: string | undefined,
): Promise<NarratorSettingReasons> {
  const templateId = mode === 'creative-writing' ? 'creative-writing' : 'adventure'
  const ctx = new ContextBuilder(packId)
  const [userTemplate, systemTemplate] = await Promise.all([
    ctx.resolveTemplate(`${templateId}-user`),
    customSystemPrompt ? undefined : ctx.resolveTemplate(templateId),
  ])
  return narratorSettingReasons({
    userTemplate: userTemplate?.content,
    systemTemplate: systemTemplate?.content,
    customSystemPrompt,
  })
}
