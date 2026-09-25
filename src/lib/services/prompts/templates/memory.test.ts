import { describe, it, expect } from 'vitest'
import { Liquid } from 'liquidjs'
import { memoryTemplates } from './memory'

const engine = new Liquid()
const loreManagement = memoryTemplates.find((t) => t.id === 'lore-management')!

const baseVars = {
  requireDuplicateResolution: false,
  entrySummary: '<<ENTRIES>>',
  duplicateSummary: '',
  recentStorySection: '<<RECENT_STORY>>',
  newChapterSection: '<<NEW_CHAPTER>>',
  chapterSummary: '<<CHAPTER_SUMMARY>>',
}

const renderContent = (vars: Record<string, unknown>) =>
  engine.parseAndRender(loreManagement.content, { ...baseVars, ...vars })

const renderUserContent = (vars: Record<string, unknown>) =>
  engine.parseAndRender(loreManagement.userContent!, { ...baseVars, ...vars })

describe('lore-management system prompt', () => {
  it('tells the agent the chapter it just wrote needs no query, when both are true', async () => {
    const out = await renderContent({
      hasChapters: true,
      hasNewChapter: true,
      hasStoryMaterial: true,
    })
    expect(out).toContain('The chapter you just wrote is given below in full')
    expect(out).toContain(
      "Use query_chapter when an earlier chapter's summary is not enough — the chapter you just wrote needs no query",
    )
    expect(out).not.toContain('There are no chapters, so query_chapter has nothing to read.')
  })

  it('says query_chapter has nothing to add when the only chapter is the new one', async () => {
    const out = await renderContent({
      hasChapters: false,
      hasNewChapter: true,
      hasStoryMaterial: true,
    })
    expect(out).toContain(
      'The only chapter is the one given below in full, so query_chapter has nothing to add.',
    )
    expect(out).not.toContain('There are no chapters, so query_chapter has nothing to read.')
    expect(out).not.toContain('Use query_chapter when an earlier')
  })

  it('keeps the original no-chapters wording when there is no story text at all', async () => {
    const out = await renderContent({
      hasChapters: false,
      hasNewChapter: false,
      hasStoryMaterial: false,
    })
    expect(out).toContain('There are no chapters, so query_chapter has nothing to read.')
    expect(out).toContain('Every chapter is there with its full summary.')
    expect(out).not.toContain('just written, in full')
  })

  it('keeps the plain complete-lists wording when there are chapters but none new', async () => {
    const out = await renderContent({
      hasChapters: true,
      hasNewChapter: false,
      hasStoryMaterial: true,
    })
    expect(out).toContain('Every chapter is there with its full summary.')
    expect(out).toContain("Use query_chapter when an earlier chapter's summary is not enough,")
    expect(out).not.toContain('needs no query')
  })
})

describe('lore-management system prompt — the recent story', () => {
  const flags = [true, false]

  it('never mentions recent material when the tail is empty', async () => {
    for (const hasChapters of flags) {
      for (const hasNewChapter of flags) {
        const out = await renderContent({
          hasChapters,
          hasNewChapter,
          hasRecentStory: false,
          hasStoryMaterial: hasChapters || hasNewChapter,
          recentStorySection: '',
        })
        expect(out, `hasChapters=${hasChapters} hasNewChapter=${hasNewChapter}`).not.toMatch(
          /recent/i,
        )
      }
    }
  })

  it('lists exactly the material present', async () => {
    const cases: [boolean, boolean, boolean, string][] = [
      [
        true,
        true,
        true,
        'the chapter you just wrote, the earlier chapter summaries and the recent story:',
      ],
      [true, true, false, 'the chapter you just wrote and the earlier chapter summaries:'],
      [false, true, true, 'the chapter you just wrote and the recent story:'],
      [false, true, false, 'the chapter you just wrote:'],
      [true, false, true, 'the chapter summaries and the recent story:'],
      [true, false, false, 'the chapter summaries:'],
      [false, false, true, 'the recent story:'],
    ]
    for (const [hasChapters, hasNewChapter, hasRecentStory, list] of cases) {
      const out = await renderContent({
        hasChapters,
        hasNewChapter,
        hasRecentStory,
        hasStoryMaterial: true,
      })
      expect(out).toContain(`go back over ${list}`)
    }
  })
})

describe('lore-management user content', () => {
  it('places the new-chapter block after duplicates and before the recent story', async () => {
    const out = await renderUserContent({
      hasChapters: true,
      hasNewChapter: true,
      duplicateSummary: '<<DUPLICATES>>',
    })
    expect(out.indexOf('<<DUPLICATES>>')).toBeLessThan(out.indexOf('<<NEW_CHAPTER>>'))
    expect(out.indexOf('<<NEW_CHAPTER>>')).toBeLessThan(out.indexOf('<<RECENT_STORY>>'))
  })

  it('omits the new-chapter block entirely when there is none', async () => {
    const out = await renderUserContent({
      hasChapters: true,
      hasNewChapter: false,
      newChapterSection: '',
    })
    expect(out).not.toContain('<<NEW_CHAPTER>>')
    expect(out).toContain('<<RECENT_STORY>>')
  })

  it('warns that the story goes on only when the excerpt is cut short', async () => {
    const cut = await renderUserContent({ hasRecentStory: true, recentStoryContinues: true })
    const whole = await renderUserContent({ hasRecentStory: true, recentStoryContinues: false })
    expect(cut).toContain('The story goes on past the end of this excerpt')
    expect(cut.indexOf('<<RECENT_STORY>>')).toBeLessThan(cut.indexOf('The story goes on'))
    expect(whole).not.toContain('The story goes on')
  })

  it('has no continuation note when there is no excerpt to be cut short', async () => {
    const out = await renderUserContent({ hasRecentStory: false, recentStoryContinues: true })
    expect(out).not.toContain('The story goes on')
  })
})
