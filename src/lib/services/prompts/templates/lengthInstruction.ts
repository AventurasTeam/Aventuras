/**
 * The `# Format` length line the narrative templates render as `{{ lengthInstruction }}`.
 *
 * Total by design — it returns a sentence for every input, including `undefined` — so the
 * templates can render the variable bare, with no `{% if %}` and no duplicated default.
 */

/** The template variable this feeds. A prompt without it cannot honour a length setting. */
export const LENGTH_INSTRUCTION_VAR = 'lengthInstruction'

export function formatLengthInstruction(targetLength?: string, mode: string = 'adventure'): string {
  const isCreative = mode === 'creative-writing'

  switch (targetLength) {
    case 'short':
      return isCreative
        ? "Length: Compact Beat (2–4 paragraphs). Deliver focused, evocative prose that executes the author's direction with economy and immediate momentum."
        : 'Length: Concise (1–3 paragraphs). Keep the prose crisp and fast-paced, focusing on immediate sensory feedback and prompt player agency.'
    case 'medium':
      return isCreative
        ? 'Length: Standard Scene (3–6 paragraphs). Balance narrative momentum with rich character voice, sensory detail, and natural scene progression.'
        : 'Length: Balanced (2–4 paragraphs). Provide immersive detail and NPC reactions while maintaining a steady narrative momentum.'
    case 'long':
      return isCreative
        ? 'Length: Full Scene / Chapter Pass (5–8+ paragraphs). Craft immersive, multi-layered literary prose, thoroughly expanding on character internalities, subtext, and vivid atmospheric texture.'
        : 'Length: Expansive (3–6 paragraphs). Develop rich environmental detail, deep character subtext, and layered narrative beats.'
    case 'dynamic':
    default:
      return isCreative
        ? "Length: Dynamic (2–8 paragraphs). Scale the depth of narration to serve the scene's momentum: brief and direct (2–3 paragraphs) during rapid back-and-forth interactions; lush and comprehensive (4–8 paragraphs) when crafting immersive chapter sections, character reflections, or evocative environment setups."
        : "Length: Dynamic (1–6 paragraphs). Adapt the response length naturally to the scene's pacing: write concise, punchy narration (1–2 paragraphs) during fast-paced action, quick dialogue exchanges, or key decision points; expand into richer, atmospheric prose (up to 5–6 paragraphs) during quiet exploration, scene transitions, or emotional beats."
  }
}

/** Whether a template body would render the length line at all. */
export function templateUsesLengthInstruction(content: string | null | undefined): boolean {
  return !!content && new RegExp(`{{\\s*${LENGTH_INSTRUCTION_VAR}\\b`).test(content)
}
