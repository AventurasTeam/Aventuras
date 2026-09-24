import { describe, it, expect } from 'vitest'
import { Liquid } from 'liquidjs'
import { generationTemplates } from './generation'

const engine = new Liquid()

const actionChoices = () => {
  const template = generationTemplates.find((t) => t.id === 'action-choices')
  if (!template?.userContent) throw new Error('action-choices has no userContent')
  return template.userContent
}

describe('action-choices user prompt', () => {
  // The choice-length hint used to arrive as `{{ lengthInstruction }}`, a constant the
  // service supplied. It is the template's own text now, so a pack can edit it.
  it('carries its own choice-length guidance', async () => {
    const out = await engine.parseAndRender(actionChoices(), { protagonistName: 'Aria' })

    expect(out).toContain('Keep each choice concise but specific - typically 5-15 words.')
    expect(actionChoices()).not.toContain('lengthInstruction')
  })

  it('does not follow the story target response length', async () => {
    const short = await engine.parseAndRender(actionChoices(), {
      protagonistName: 'Aria',
      targetResponseLength: 'short',
    })
    const long = await engine.parseAndRender(actionChoices(), {
      protagonistName: 'Aria',
      targetResponseLength: 'long',
    })

    expect(short).toBe(long)
  })
})
