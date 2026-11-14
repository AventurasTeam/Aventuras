import { describe, expect, it } from 'vitest'

import { entityStateSchemaForKind } from '@/lib/db'
import { PRODUCTION_CLOSE_SLOTS } from '@/lib/pipeline/definitions/close-agent/slots'
import type { WriteTool } from '@/lib/pipeline/definitions/close-agent/tool'

import { CREATE_LORE_TOOL } from './close-review-changes'
import { MERGE_TOOLS, PLACEMENT_PATHS } from './close-review-not-applied'

const closeWriteTools = (): WriteTool[] =>
  [
    ...PRODUCTION_CLOSE_SLOTS.before,
    ...PRODUCTION_CLOSE_SLOTS.perPart,
    ...PRODUCTION_CLOSE_SLOTS.after,
  ].flatMap((entry) =>
    entry.kind === 'task' ? entry.def.tools.filter((tool) => tool.kind === 'write') : [],
  )

// The review classifies a call by its tool's name; a renamed tool would silently change its rows.
describe("the review's names for the close's tools and paths", () => {
  it('names as merges exactly the write tools that keep one row and absorb others', () => {
    const merges = closeWriteTools()
      .filter((tool) => Object.hasOwn(tool.ids, 'keep') && Object.hasOwn(tool.ids, 'absorb'))
      .map((tool) => tool.name)

    expect(merges.length).toBeGreaterThan(0)
    expect([...MERGE_TOOLS].sort()).toEqual(merges.sort())
  })

  it('names as the create the one write tool that names no row, minting its own', () => {
    const creates = closeWriteTools()
      .filter((tool) => Object.keys(tool.ids).length === 0)
      .map((tool) => tool.name)

    expect(creates).toEqual([CREATE_LORE_TOOL])
  })

  it("reads each placement path as a place's own state field", () => {
    const paths = Object.keys(entityStateSchemaForKind('location').shape).map(
      (field) => `state.${field}`,
    )

    expect(PLACEMENT_PATHS.size).toBeGreaterThan(0)
    expect([...PLACEMENT_PATHS].filter((path) => !paths.includes(path))).toEqual([])
  })
})
