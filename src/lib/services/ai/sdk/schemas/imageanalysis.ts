/**
 * Image Analysis Schemas
 *
 * Zod schemas for scene analysis output from the LLM.
 * Used by ImageAnalysisService to identify imageable moments in narrative text.
 */

import * as z from 'zod'

/**
 * Schema for a single imageable scene identified in narrative text.
 */
export const imageableSceneSchema = z.object({
  prompt: z
    .string()
    .describe(
      'Detailed image generation prompt (below 500 characters for standard, shorter for reference mode)',
    ),
  sourceText: z
    .string()
    .describe('Exact verbatim quote from narrative (3-15 words) for text matching'),
  sceneType: z
    .enum(['action', 'item', 'character', 'environment'])
    .describe('Type of visual moment'),
  priority: z.number().min(1).max(10).describe('Priority 1-10, higher = more important'),
  characters: z
    .array(z.string())
    .default([])
    .describe('Character names depicted (up to 3, first is primary)'),
  generatePortrait: z
    .boolean()
    .default(false)
    .describe('If true, generate a portrait for the first character'),
})

/**
 * Schema for the complete scene analysis result.
 */
export const sceneAnalysisResultSchema = z.object({
  scenes: z.array(imageableSceneSchema).describe('Array of identified imageable scenes'),
})

export const backgroundImageAnalysisResultSchema = z.object({
  changeNecessary: z.boolean().describe('Whether the background image needs to be changed'),
  prompt: z.string().describe('Prompt for generating background image'),
})

export type ImageableScene = z.infer<typeof imageableSceneSchema>
// Each portrait is its own save; two for one character race to copy it onto the branch.
export function dropDuplicatePortraits(scenes: ImageableScene[]): ImageableScene[] {
  const seen = new Set<string>()
  return scenes.filter((s) => {
    if (!s.generatePortrait || s.characters.length === 0) return true
    const key = s.characters[0].toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type SceneAnalysisResult = z.infer<typeof sceneAnalysisResultSchema>
export type BackgroundImageAnalysisResult = z.infer<typeof backgroundImageAnalysisResultSchema>
