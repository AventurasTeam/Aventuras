import { describe, expect, it } from 'vitest'

import { STORY_SETTINGS_DEFAULTS, type Story, type StorySettings } from '@/lib/db'

import { storySettingsPanelData } from './panel-data'

function storyRow(settings: unknown, overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    title: 'Ashfall',
    description: 'A dust-choked city.',
    tags: ['grim', 'urban'],
    coverAssetId: null,
    accentColor: '#a31',
    status: 'active',
    favorite: 1,
    lastOpenedAt: 1000,
    definition: { mode: 'creative' } as Story['definition'],
    settings: settings as Story['settings'],
    createdAt: 1,
    updatedAt: 2,
    currentBranchId: 'branch-1',
    ...overrides,
  }
}

describe('storySettingsPanelData', () => {
  it('reports a missing story before the read and an unavailable one after a failed read', () => {
    expect(storySettingsPanelData(undefined, 'ok', storyRow(STORY_SETTINGS_DEFAULTS))).toEqual({
      status: 'missing',
    })
    expect(storySettingsPanelData('story-1', 'pending', undefined)).toEqual({ status: 'loading' })
    expect(storySettingsPanelData('story-1', 'failed', undefined)).toEqual({
      status: 'unavailable',
    })
    expect(storySettingsPanelData('story-1', 'ok', undefined)).toEqual({ status: 'missing' })
  })

  it('holds at loading while the read is pending, even with a row already in hand', () => {
    expect(storySettingsPanelData('story-1', 'pending', storyRow('not settings'))).toEqual({
      status: 'loading',
    })
  })

  it('separates a story with no settings from one whose settings do not parse', () => {
    expect(storySettingsPanelData('story-1', 'ok', storyRow(null))).toEqual({
      status: 'uninitialized',
    })
    expect(storySettingsPanelData('story-1', 'ok', storyRow('not settings'))).toEqual({
      status: 'corrupt',
    })
  })

  it('refuses a blob missing a required key rather than rendering panels over it', () => {
    const { classifierCadence: _dropped, ...withoutCadence } = STORY_SETTINGS_DEFAULTS
    expect(storySettingsPanelData('story-1', 'ok', storyRow(withoutCadence))).toEqual({
      status: 'corrupt',
    })
  })

  it('refuses an absent models key, which panels dereference unguarded', () => {
    const { models: _dropped, ...withoutModels } = STORY_SETTINGS_DEFAULTS
    expect(storySettingsPanelData('story-1', 'ok', storyRow(withoutModels))).toEqual({
      status: 'corrupt',
    })
  })

  it('refuses a pre-0014 bare-string model override', () => {
    const stored = { ...STORY_SETTINGS_DEFAULTS, models: { narrative: 'gpt-4' } }
    expect(storySettingsPanelData('story-1', 'ok', storyRow(stored))).toEqual({
      status: 'corrupt',
    })
  })

  it('carries the parsed settings, so a key the schema defaults is never undefined', () => {
    const { partialChapterBuffer: _absent, ...withoutBuffer } = STORY_SETTINGS_DEFAULTS
    const data = storySettingsPanelData('story-1', 'ok', storyRow(withoutBuffer))

    expect(data.status).toBe('ready')
    if (data.status !== 'ready') return
    // The schema's own default, not the stored blob's absence.
    expect(data.settings.partialChapterBuffer).toBe(10)
  })

  it('projects the library columns and the definition onto a ready panel', () => {
    const tuned: StorySettings = { ...STORY_SETTINGS_DEFAULTS, classifierCadence: 9 }
    const data = storySettingsPanelData('story-1', 'ok', storyRow(tuned))

    expect(data).toEqual({
      status: 'ready',
      settings: expect.objectContaining({ classifierCadence: 9 }),
      definition: { mode: 'creative' },
      story: {
        title: 'Ashfall',
        description: 'A dust-choked city.',
        tags: ['grim', 'urban'],
        accentColor: '#a31',
        status: 'active',
        favorite: 1,
      },
    })
  })

  it('reports a ready panel with no definition rather than refusing the row', () => {
    const data = storySettingsPanelData(
      'story-1',
      'ok',
      storyRow(STORY_SETTINGS_DEFAULTS, { definition: null }),
    )

    expect(data.status).toBe('ready')
    if (data.status !== 'ready') return
    expect(data.definition).toBeNull()
  })
})
