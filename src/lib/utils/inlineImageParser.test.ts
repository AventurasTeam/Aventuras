import { describe, it, expect } from 'vitest'
import {
  extractPicTags,
  hasIncompletePicTag,
  stripPicTags,
  replacePicTagsWithPlaceholders,
  renderSinglePicTag,
  type ImageReplacementInfo,
} from './inlineImageParser'

const SELF_CLOSING = '<pic prompt="a lone knight on a windswept ridge" />'
const PAIRED = '<pic prompt="a lone knight on a windswept ridge"></pic>'

function imageMap(
  tag: string,
  info: Partial<ImageReplacementInfo> & Pick<ImageReplacementInfo, 'status'>,
): Map<string, ImageReplacementInfo> {
  return new Map([[tag, { id: 'img-1', imageData: 'QUJD', ...info }]])
}

describe('extractPicTags', () => {
  it('reads a self-closing tag with its position', () => {
    const content = `Before. ${SELF_CLOSING} After.`
    const [tag] = extractPicTags(content)

    expect(tag.prompt).toBe('a lone knight on a windswept ridge')
    expect(tag.originalTag).toBe(SELF_CLOSING)
    expect(content.slice(tag.startIndex, tag.endIndex)).toBe(SELF_CLOSING)
    expect(tag.characters).toEqual([])
  })

  it('reads the paired form the same way', () => {
    expect(extractPicTags(PAIRED)[0]?.prompt).toBe('a lone knight on a windswept ridge')
  })

  it('splits the characters attribute and drops empty names', () => {
    const [tag] = extractPicTags(
      `<pic prompt="two figures beneath the archway" characters="Aria, , Malakor " />`,
    )
    expect(tag.characters).toEqual(['Aria', 'Malakor'])
  })

  it('accepts the attributes in either order', () => {
    const [tag] = extractPicTags(
      `<pic characters="Aria" prompt="two figures beneath the archway" />`,
    )
    expect(tag.prompt).toBe('two figures beneath the archway')
    expect(tag.characters).toEqual(['Aria'])
  })

  it('finds every tag in a passage, in document order', () => {
    const content = `${SELF_CLOSING} middle ${PAIRED}`
    const tags = extractPicTags(content)

    expect(tags).toHaveLength(2)
    expect(tags[0].startIndex).toBeLessThan(tags[1].startIndex)
  })

  it('rejects a prompt shorter than the ten-character floor', () => {
    // The floor exists because a one-word prompt produces a useless image; it is cheaper
    // to render nothing than to spend a generation on "a sword".
    expect(extractPicTags('<pic prompt="a sword" />')).toEqual([])
  })

  it('rejects a tag with no prompt at all', () => {
    expect(extractPicTags('<pic characters="Aria" />')).toEqual([])
  })

  it('returns nothing for content with no tags', () => {
    expect(extractPicTags('Just prose, no markup.')).toEqual([])
  })

  it('keeps an apostrophe inside a double-quoted prompt', () => {
    // The old pattern `["']([^"']+)["']` could not tell a closing quote from an apostrophe
    // in the prose: it captured `a knight`, which fell under the ten-character floor, so
    // the tag was dropped and the image never generated -- silently, mid-narration.
    const [tag] = extractPicTags(`<pic prompt="a knight's blade held high" />`)
    expect(tag.prompt).toBe("a knight's blade held high")
  })

  it('keeps a double quote inside a single-quoted prompt', () => {
    const [tag] = extractPicTags(`<pic prompt='a banner reading "war" over the ridge' />`)
    expect(tag.prompt).toBe('a banner reading "war" over the ridge')
  })

  it('keeps an angle bracket inside a prompt', () => {
    // `[^>]*?` ended the match at the first `>`, so no rule fired at all and the raw tag
    // survived into rendered narration.
    const [tag] = extractPicTags('<pic prompt="a sign reading 10 > 9 above the door" />')
    expect(tag.prompt).toBe('a sign reading 10 > 9 above the door')
  })

  it('does not let an unterminated tag swallow the narration after it', () => {
    // The reason the pattern still forbids `>` outside a quoted run.
    expect(extractPicTags('<pic prompt="never closed and then more prose')).toEqual([])
  })
})

describe('hasIncompletePicTag', () => {
  it('reports a clean stream when there is no tag', () => {
    expect(hasIncompletePicTag('plain narration')).toEqual({
      incomplete: false,
      safeEnd: 'plain narration'.length,
    })
  })

  it('reports a clean stream once the tag has closed', () => {
    const content = `text ${SELF_CLOSING} more`
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: false, safeEnd: content.length })
  })

  it('holds back everything from a half-arrived tag onward', () => {
    const content = 'text <pic prompt="a lone knight on a'
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: true, safeEnd: 5 })
  })

  it('only judges the last tag, so a closed one before an open one is not enough', () => {
    const content = `${SELF_CLOSING} and then <pic prompt="another sce`
    expect(hasIncompletePicTag(content)).toEqual({
      incomplete: true,
      safeEnd: content.lastIndexOf('<pic'),
    })
  })

  it('is not fooled by "/>" inside an attribute value still being streamed', () => {
    // The old check looked for the closing characters anywhere after the opener, so this
    // was declared complete mid-stream, the renderer ran, and half a tag reached the page.
    const content = 'text <pic prompt="the sign read 10 /> 9'
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: true, safeEnd: 5 })
  })

  it('is not fooled by a bare ">" inside an attribute value either', () => {
    const content = 'text <pic prompt="the sign read 10 > 9'
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: true, safeEnd: 5 })
  })

  it('recognises the tag as complete once those characters really do close it', () => {
    const content = 'text <pic prompt="the sign read 10 /> 9" />'
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: false, safeEnd: content.length })
  })

  it('treats an unterminated quote as incomplete, however long the tail grows', () => {
    // A quote that never closes is the normal mid-stream state, and must stay held back
    // rather than flipping to "complete" when later prose happens to contain "/>".
    const content = 'text <pic prompt="still typing and then /> later'
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: true, safeEnd: 5 })
  })

  it('holds back a paired tag whose </pic> has not arrived', () => {
    const content = 'text <pic prompt="a lone knight on a ridge">'
    expect(hasIncompletePicTag(content)).toEqual({ incomplete: true, safeEnd: 5 })
  })
})

describe('stripPicTags', () => {
  it('removes every tag and leaves the prose', () => {
    expect(stripPicTags(`One. ${SELF_CLOSING} Two. ${PAIRED} Three.`)).toBe('One.  Two.  Three.')
  })

  it('leaves content without tags untouched', () => {
    expect(stripPicTags('untouched')).toBe('untouched')
  })
})

describe('replacePicTagsWithPlaceholders', () => {
  it('swaps the tag for a generating placeholder carrying the prompt', () => {
    const html = replacePicTagsWithPlaceholders(SELF_CLOSING)

    expect(html).toContain('inline-image-placeholder generating')
    expect(html).toContain('data-prompt="a lone knight on a windswept ridge"')
    expect(html).not.toContain('<pic')
  })

  it('escapes an ampersand so the prompt cannot break out of the attribute', () => {
    const html = replacePicTagsWithPlaceholders(
      '<pic prompt="a banner reading fire &amp; ash over the ridge" />',
    )
    expect(html).toContain('data-prompt="a banner reading fire &amp;amp; ash over the ridge"')
    expect(html).not.toContain('<pic')
  })

  it('handles a prompt containing ">" in every rule, not just the parser', () => {
    // Every rule used to share `[^>]*?` and they all missed this tag together, so a raw
    // `<pic ...>` string reached rendered narration while `stripPicTags` reported there
    // was nothing to strip.
    const withAngle = '<pic prompt="a sign reading 10 > 9 above the door" />'

    expect(stripPicTags(withAngle)).toBe('')
    expect(replacePicTagsWithPlaceholders(withAngle)).not.toContain('<pic')
    expect(extractPicTags(withAngle)).toHaveLength(1)
  })

  it('escapes the angle bracket rather than emitting it into the placeholder markup', () => {
    const html = replacePicTagsWithPlaceholders(
      '<pic prompt="a sign reading 10 > 9 above the door" />',
    )
    expect(html).toContain('&gt;')
    expect(html).toContain('data-prompt="a sign reading 10 &gt; 9 above the door"')
  })
})

describe('renderSinglePicTag', () => {
  it('offers to recreate a tag whose image record is missing', () => {
    const html = renderSinglePicTag(SELF_CLOSING, new Map())

    expect(html).toContain('Image record missing')
    expect(html).toContain('data-action="create-missing"')
  })

  it('offers a retry on an image that has been waiting too long', () => {
    const map = imageMap(SELF_CLOSING, { status: 'generating' })
    const id = map.get(SELF_CLOSING)!.id

    expect(renderSinglePicTag(SELF_CLOSING, map)).not.toContain('data-action="regenerate"')
    expect(renderSinglePicTag(SELF_CLOSING, map, { stuckIds: new Set([id]) })).toContain(
      'data-action="regenerate"',
    )
  })

  it('reports a missing record with no prompt, but offers nothing to generate from it', () => {
    const html = renderSinglePicTag('<pic prompt="" />', new Map())

    expect(html).toContain('Image record missing')
    expect(html).not.toContain('data-action="create-missing"')
  })

  it('waits out the grace period before calling a missing record lost', () => {
    const html = renderSinglePicTag(SELF_CLOSING, new Map(), { offerMissingRecovery: false })

    expect(html).not.toContain('data-action="create-missing"')
    expect(html).toContain('In queue...')
  })

  it('renders the finished image inline', () => {
    const html = renderSinglePicTag(SELF_CLOSING, imageMap(SELF_CLOSING, { status: 'complete' }))

    expect(html).toContain('inline-generated-image')
    expect(html).toContain('src="data:image/png;base64,QUJD"')
    expect(html).not.toContain('regenerating')
  })

  it('overlays the previous image while it is being regenerated', () => {
    const html = renderSinglePicTag(SELF_CLOSING, imageMap(SELF_CLOSING, { status: 'complete' }), {
      regeneratingIds: new Set(['img-1']),
    })

    expect(html).toContain('regenerating')
    // The old image stays visible underneath rather than the frame going blank.
    expect(html).toContain('src="data:image/png;base64,QUJD"')
  })

  it('falls back to a placeholder when a complete record carries no data', () => {
    const html = renderSinglePicTag(
      SELF_CLOSING,
      imageMap(SELF_CLOSING, { status: 'complete', imageData: '' }),
    )
    expect(html).toContain('inline-image-placeholder')
  })

  it('shows the provider error and a retry control on failure', () => {
    const html = renderSinglePicTag(
      SELF_CLOSING,
      imageMap(SELF_CLOSING, { status: 'failed', errorMessage: 'quota exceeded' }),
    )

    expect(html).toContain('inline-image-placeholder failed')
    expect(html).toContain('quota exceeded')
    expect(html).toContain('data-action="regenerate"')
    expect(html).toContain('data-image-id="img-1"')
  })

  it('names a generic failure when the provider gave no message', () => {
    const html = renderSinglePicTag(SELF_CLOSING, imageMap(SELF_CLOSING, { status: 'failed' }))
    expect(html).toContain('Generation failed')
  })

  it('distinguishes queued from in-flight', () => {
    const pending = renderSinglePicTag(SELF_CLOSING, imageMap(SELF_CLOSING, { status: 'pending' }))
    const generating = renderSinglePicTag(
      SELF_CLOSING,
      imageMap(SELF_CLOSING, { status: 'generating' }),
    )

    expect(pending).toContain('In queue...')
    expect(generating).toContain('Generating image...')
  })

  it('truncates a long prompt in the visible label but keeps it whole in the data attribute', () => {
    const long = 'a '.repeat(60) + 'ridge'
    const tag = `<pic prompt="${long}" />`
    const html = renderSinglePicTag(tag, imageMap(tag, { status: 'generating' }))

    expect(html).toContain(`${long.slice(0, 60)}...`)
    expect(html).toContain(`data-prompt="${long}"`)
  })
})

describe('PIC_TAG — malformed input', () => {
  /**
   * The attribute section is `(?:"[^"]*"|'[^']*'|[^>"'])*?`, and the three branches are what
   * keep it linear: each is anchored on a distinct first character, so there is no input the
   * engine can match two ways and no exponential path to explore. Widening the last branch to
   * `[^>]` -- the obvious-looking simplification -- would overlap the quoted ones and
   * reintroduce exactly that.
   *
   * These pin the behaviour that depends on it. The timing bound is deliberately loose: it is
   * there to fail on a pattern that degenerates, not to measure anything.
   */
  const budgetMs = 500

  const timed = (fn: () => void) => {
    const started = performance.now()
    fn()
    return performance.now() - started
  }

  it('does not match an unterminated quote, however much prose follows', () => {
    // The failure this guards against is not a missing image: it is the literal `<pic ...`
    // text surviving into rendered narration while the parser reports nothing to strip.
    const content = `<pic prompt="never closed ${'word '.repeat(4000)}`

    expect(extractPicTags(content)).toEqual([])
    expect(stripPicTags(content)).toBe(content)
  })

  it('stays linear on a long run of paired quotes', () => {
    const content = `<pic ${'"a"'.repeat(3000)}`
    expect(timed(() => extractPicTags(content))).toBeLessThan(budgetMs)
  })

  it('stays linear on a long run of unpaired quotes', () => {
    const content = `<pic ${'"'.repeat(3000)}`
    expect(timed(() => extractPicTags(content))).toBeLessThan(budgetMs)
  })

  it('stays linear when both quote characters alternate', () => {
    const content = `<pic ${`'a'"b"`.repeat(2000)}`
    expect(timed(() => extractPicTags(content))).toBeLessThan(budgetMs)
  })

  it('stays linear on an opened tag that never closes', () => {
    const content = `<pic prompt="a" ${'x'.repeat(20000)}`
    expect(timed(() => extractPicTags(content))).toBeLessThan(budgetMs)
  })

  it('recovers on the next well-formed tag after a broken one', () => {
    // A single malformed tag must not cost the rest of the narration its images. The broken
    // prefix is discarded whole: the match that succeeds starts at the second `<pic`, so the
    // good tag arrives with its own prompt intact rather than one spanning both.
    const content = `<pic prompt="broken ${SELF_CLOSING}`

    const tags = extractPicTags(content)
    expect(tags).toHaveLength(1)
    expect(tags[0].prompt).toBe('a lone knight on a windswept ridge')
    expect(content.slice(tags[0].startIndex, tags[0].endIndex)).toBe(SELF_CLOSING)
  })
})
