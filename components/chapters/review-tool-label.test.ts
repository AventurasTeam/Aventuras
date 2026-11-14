import { describe, expect, it } from 'vitest'

import { PRODUCTION_CLOSE_SLOTS } from '@/lib/pipeline/definitions/close-agent/slots'

import { TOOL_LABEL_KEYS } from './review-tool-label'

const closeWriteTools = (): string[] =>
  [
    ...PRODUCTION_CLOSE_SLOTS.before,
    ...PRODUCTION_CLOSE_SLOTS.perPart,
    ...PRODUCTION_CLOSE_SLOTS.after,
  ].flatMap((entry) =>
    entry.kind === 'task'
      ? entry.def.tools.filter((tool) => tool.kind === 'write').map((tool) => tool.name)
      : [],
  )

describe('TOOL_LABEL_KEYS', () => {
  it('labels every write tool a close task can call', () => {
    const tools = closeWriteTools()

    expect(tools.length).toBeGreaterThan(0)
    expect(tools.filter((tool) => !Object.hasOwn(TOOL_LABEL_KEYS, tool))).toEqual([])
  })
})
