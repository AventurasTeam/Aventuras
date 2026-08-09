import { describe, it, expect } from 'vitest'
import type { EmbeddedImage } from '$lib/types'
import { processStoryContent } from './ImageEmbeddingService'

/**
 * An agentic image anchored to a run of narration. `sourceText` must be at least 20
 * characters or the marker is filtered out before any of this applies.
 */
function agenticImage(sourceText: string, id = 'img-1'): EmbeddedImage {
  return {
    id,
    storyId: 'story-1',
    entryId: 'entry-1',
    sourceText,
    prompt: '',
    styleId: '',
    model: '',
    imageData: '',
    status: 'complete',
    createdAt: 0,
    generationMode: 'analyzed',
  }
}

describe('embedded image markers and dialogue', () => {
  it('renders markdown inside a marker instead of splicing it back raw', () => {
    const html = processStoryContent('The *ancient* door groaned open before them.', [
      agenticImage('The *ancient* door groaned open before them.'),
    ])

    expect(html).toContain('<em>ancient</em>')
    expect(html).not.toContain('*ancient*')
  })

  it('colours dialogue that sits entirely inside a marker', () => {
    const html = processStoryContent('He turned. "Who are you?" he asked.', [
      agenticImage('. "Who are you?" he asked'),
    ])

    expect(html).toContain('embedded-image-link')
    expect(html).toContain('<span class="dialogue-line">"Who are you?"</span>')
  })

  it('widens a marker that would cut a quote in half', () => {
    // Without the snap the marker ends mid-quote, the surviving text holds one
    // unterminated quote, and the line loses its colour with nothing to explain it.
    const html = processStoryContent('She stepped back. "Who... who are you?" The lantern swung.', [
      agenticImage('She stepped back. "Who... who are you'),
    ])

    expect(html).toContain('<span class="dialogue-line">"Who... who are you?"</span>')
    // The quote was swallowed by the link rather than left dangling outside it.
    expect(html).not.toMatch(/<\/span>\?/)
  })

  it('leaves both markers alone when widening would collide', () => {
    // Two images anchored either side of one quote. Each would have to grow across
    // the other to cover it, and an overlap corrupts both replacements — worse than
    // an uncoloured quote. So neither moves and the quote stays plain.
    const html = processStoryContent(
      'Dawn broke slowly here. "Who are you truly?" Nobody moved an inch at all.',
      [
        agenticImage('Dawn broke slowly here. "Who are you', 'img-1'),
        agenticImage('truly?" Nobody moved an inch at all.', 'img-2'),
      ],
    )

    expect(html).toContain('data-image-id="img-1"')
    expect(html).toContain('data-image-id="img-2"')
    expect(html).not.toContain('dialogue-line')
  })
})
