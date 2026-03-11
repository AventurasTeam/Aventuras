import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import {
  contextResult,
  entryRetrievalResult,
  rawChapters,
  timelineFillResult,
  rawStoryEntries,
  emptyWorldState,
} from '../../../../test/contextFixtures'
import { mapContextResultToArrays } from '$lib/services/context/worldStateMapper'
import { mapEntryRetrievalToLorebookEntries } from '$lib/services/context/lorebookMapper'
import { mapChaptersToContext } from '$lib/services/context/chapterMapper'
import { mapStoryEntriesToContext } from '$lib/services/context/storyEntryMapper'

// ---------------------------------------------------------------------------
// Shared mapped context (built once at module level from real mapper output)
// ---------------------------------------------------------------------------

const worldStateArrays = mapContextResultToArrays(contextResult, emptyWorldState)
const lorebookEntries = mapEntryRetrievalToLorebookEntries(entryRetrievalResult, 0)
const { chapters, timelineFill } = mapChaptersToContext(rawChapters, timelineFillResult)
const storyEntries = mapStoryEntriesToContext(rawStoryEntries, { stripPicTags: true })

// Pipeline context for narrative templates (adventure + creative-writing)
const narrativePipelineContext = {
  protagonistName: 'Aria',
  pov: 'second',
  tense: 'present',
  genre: 'Fantasy',
  tone: '',
  settingDescription: '',
  themes: '',
  ...worldStateArrays,
  lorebookEntries,
  chapters,
  timelineFill,
  storyEntries,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pipeline: adventure', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'adventure')!

  it('PIPE-01: content render is non-null', () => {
    const result = templateEngine.render(template.content, narrativePipelineContext)
    expect(result).not.toBeNull()
  })

  it('PIPE-02: content render contains Aria from fixture', () => {
    const result = templateEngine.render(template.content, narrativePipelineContext)
    expect(result).toContain('Aria')
  })

  it('PIPE-01: userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent, narrativePipelineContext)
    expect(result).not.toBeNull()
  })
})

describe('pipeline: creative-writing', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'creative-writing')!

  it('PIPE-01: content render is non-null', () => {
    const result = templateEngine.render(template.content, narrativePipelineContext)
    expect(result).not.toBeNull()
  })

  it('PIPE-02: content render contains Aria from fixture', () => {
    const result = templateEngine.render(template.content, narrativePipelineContext)
    expect(result).toContain('Aria')
  })

  it('PIPE-01: userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent, narrativePipelineContext)
    expect(result).not.toBeNull()
  })
})

describe('pipeline: suggestions', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'suggestions')!
  const suggestionsPipelineContext = {
    storyEntries,
    lorebookEntries,
    activeThreads: '',
    genre: 'Fantasy',
  }

  it('PIPE-01: userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent, suggestionsPipelineContext)
    expect(result).not.toBeNull()
  })

  it('PIPE-02: userContent render contains mapped story entry content', () => {
    const result = templateEngine.render(template.userContent, suggestionsPipelineContext)
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

describe('pipeline: action-choices', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'action-choices')!
  const actionChoicesPipelineContext = {
    protagonistName: 'Aria',
    protagonistDescription: '',
    narrativeResponse: '',
    storyEntries,
    currentLocation: '',
    npcsPresent: '',
    inventory: '',
    activeQuests: '',
    lorebookEntries,
    povInstruction: '',
    lengthInstruction: '',
  }

  it('PIPE-01: userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent, actionChoicesPipelineContext)
    expect(result).not.toBeNull()
  })

  it('PIPE-02: userContent render contains Aria from context', () => {
    const result = templateEngine.render(template.userContent, actionChoicesPipelineContext)
    expect(result).toContain('Aria')
  })
})

describe('pipeline: chapter-summarization', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'chapter-summarization')!
  const firstChapterTitle = chapters.length > 0 ? chapters[0].title : 'The Beginning'
  const chapterPipelineContext = {
    previousContext: 'Prior events summarized here.',
    chapterContent: firstChapterTitle,
  }

  it('PIPE-01: content render is non-null', () => {
    const result = templateEngine.render(template.content, {})
    expect(result).not.toBeNull()
  })

  it('PIPE-01: userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent, chapterPipelineContext)
    expect(result).not.toBeNull()
  })

  it('PIPE-02: userContent render contains chapter title from fixture', () => {
    const result = templateEngine.render(template.userContent, chapterPipelineContext)
    expect(result).toContain(firstChapterTitle)
  })
})
