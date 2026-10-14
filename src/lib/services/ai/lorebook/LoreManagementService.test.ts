import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Chapter } from '#lib/types/index.ts'

const recorder = vi.hoisted(() => ({ current: null as any }))
vi.mock('#lib/stores/activity.svelte.ts', () => ({
  get activity() {
    return recorder.current
  },
}))
vi.mock('#lib/stores/debug.svelte.ts', () => ({
  debug: { addDebugRequest: vi.fn(), addDebugResponse: vi.fn() },
}))
vi.mock('#lib/stores/settings.svelte.ts', () => ({
  settings: { getServicePresetId: vi.fn(() => 'preset') },
}))
vi.mock('#lib/services/context/index.ts', () => ({
  ContextBuilder: class {
    static async forPack() {
      return new this()
    }
    add() {}
    async render() {
      return { system: 'system', user: 'user' }
    }
  },
}))

/** What the fake agent does between its model calls, given the tools it was built with. */
const script = vi.hoisted(() => ({ run: null as any }))
vi.mock('../sdk/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sdk/agents')>()
  return {
    ...actual,
    createAgentFromPreset: (options: any) => ({
      generate: async () => {
        return { steps: (await script.run(options)) ?? [] }
      },
    }),
  }
})

import { ActivityRecorder } from '#lib/services/activity/index.ts'
import { LoreManagementService } from './LoreManagementService'

const chapter = { id: 'c5', number: 5, title: 'The Ferry', summary: 'They crossed.' } as Chapter

function context(over: Record<string, unknown> = {}) {
  return {
    storyId: 's',
    recentEntries: [],
    existingEntries: [],
    chapters: [chapter],
    mode: 'adventure' as const,
    pov: 'second' as const,
    tense: 'present' as const,
    ...over,
  }
}

let parent = ''
beforeEach(() => {
  recorder.current = new ActivityRecorder()
  recorder.current.setReporting('tree')
  recorder.current.startTurn('entry')
  parent = recorder.current.startStep('Lore management')
})
const steps = () => (recorder.current as ActivityRecorder).activeTurn!.steps.slice(1)

describe('LoreManagementService steps', () => {
  it('records each model call, numbered, under the given parent', async () => {
    script.run = async (options: any) => {
      options.prepareStep({ stepNumber: 0, steps: [] })
      options.prepareStep({ stepNumber: 1, steps: [] })
    }

    await new LoreManagementService('loreManagement' as any, 5).runSession(
      context({ activityParentId: parent }),
    )

    expect(steps().map((s) => [s.label, s.parentId, s.isLLM, s.status])).toEqual([
      ['Model call 1', parent, true, 'done'],
      ['Model call 2', parent, true, 'done'],
    ])
  })

  it('names each model call by why the loop makes it', async () => {
    const first = { toolCalls: [{ toolName: 'list_entries' }, { toolName: 'update_entry' }] }
    script.run = async (options: any) => {
      options.prepareStep({ stepNumber: 0, steps: [] })
      options.prepareStep({ stepNumber: 1, steps: [first] })
      options.prepareStep({ stepNumber: 4, steps: [first] })
    }

    await new LoreManagementService('loreManagement' as any, 5).runSession(
      context({ activityParentId: parent }),
    )

    expect(steps().map((s) => s.detail)).toEqual([
      'Review the lorebook',
      'Continue after reviewing entries and revising 1 entry',
      'Sum up: step limit reached',
    ])
  })

  it('records each tool call beside the model calls, ending the call that asked for it', async () => {
    const queryChapter = vi.fn(async () => 'Ilsa left.')
    script.run = async (options: any) => {
      options.prepareStep({ stepNumber: 0, steps: [] })
      await options.tools.query_chapter.execute({ chapterNumber: 5, question: 'Who left?' }, {})
      await options.tools.read_entry.execute({ index: 99 }, {})
      options.prepareStep({ stepNumber: 1, steps: [] })
    }

    await new LoreManagementService('loreManagement' as any, 5).runSession(
      context({ activityParentId: parent, queryChapter }),
    )

    const recorded = steps()
    expect(recorded.map((s) => [s.label, s.parentId, s.isLLM, s.status])).toEqual([
      ['Model call 1', parent, true, 'done'],
      ['Read Chapter 5', parent, true, 'done'],
      ['Read entry 99', parent, false, 'failed'],
      ['Model call 2', parent, true, 'done'],
    ])
    // The read's own step is where its request records itself.
    expect(queryChapter).toHaveBeenCalledWith(5, 'Who left?', recorded[1].id)
    expect(recorded[0].endedAt).toBeLessThanOrEqual(recorded[1].startedAt)
  })

  it('fails the model call in flight when the agent throws', async () => {
    script.run = async (options: any) => {
      options.prepareStep({ stepNumber: 0, steps: [] })
      throw new Error('context overflow')
    }

    await expect(
      new LoreManagementService('loreManagement' as any, 5).runSession(
        context({ activityParentId: parent }),
      ),
    ).rejects.toThrow('context overflow')

    expect(steps()[0]).toMatchObject({ status: 'failed', error: 'context overflow' })
  })

  it('records nothing without a parent', async () => {
    script.run = async (options: any) => {
      options.prepareStep({ stepNumber: 0, steps: [] })
    }

    await new LoreManagementService('loreManagement' as any, 5).runSession(context())

    expect(steps()).toEqual([])
  })
})
