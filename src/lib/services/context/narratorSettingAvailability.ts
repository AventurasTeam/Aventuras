import {
  narratorSettingAvailability,
  type NarratorSettingAvailability,
} from '$lib/services/prompts/templates'
import { ContextBuilder } from './context-builder'

export type { NarratorSettingAvailability }

/** Resolves the narrator prompts a story on this pack and mode would send, and checks both settings. */
export async function resolveNarratorSettingAvailability(
  packId: string,
  mode: string | undefined,
  customSystemPrompt: string | undefined,
): Promise<NarratorSettingAvailability> {
  const templateId = mode === 'creative-writing' ? 'creative-writing' : 'adventure'
  const ctx = new ContextBuilder(packId)
  const [userTemplate, systemTemplate] = await Promise.all([
    ctx.resolveTemplate(`${templateId}-user`),
    ctx.resolveTemplate(templateId),
  ])
  return narratorSettingAvailability({
    userTemplate: userTemplate?.content,
    systemTemplate: systemTemplate?.content,
    customSystemPrompt,
  })
}
