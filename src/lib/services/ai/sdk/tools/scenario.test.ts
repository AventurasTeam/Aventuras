import { describe, it, expect, vi } from 'vitest'
import { createScenarioTools, toScenarioDetails } from './scenario'
import type { VaultPendingChange } from '../schemas/vault'
import type { VaultScenario } from '#lib/types/index.ts'

const scenario = {
  id: 's1',
  name: 'Harbour',
  description: null,
  settingSeed: 'A port town.',
  npcs: [],
  primaryCharacterName: 'Mara',
  firstMessage: 'The ferry horn sounds.',
  alternateGreetings: [],
  startingTime: { years: 0, days: 2, hours: 21, minutes: 0 },
  tags: [],
  favorite: false,
  source: 'manual',
} as unknown as VaultScenario

function setup(list: VaultScenario[] = [scenario]) {
  const onPendingChange = vi.fn<(change: VaultPendingChange) => void>()
  const tools = createScenarioTools({
    scenarios: () => list,
    onPendingChange,
    generateId: () => 'c1',
  })
  return { tools, onPendingChange }
}

async function run(tool: { execute?: unknown }, input: object) {
  const execute = tool.execute as (input: object, options: object) => Promise<unknown>
  return (await execute(input, {})) as { success: boolean; error?: string }
}

function changeData(onPendingChange: ReturnType<typeof setup>['onPendingChange']) {
  const change = onPendingChange.mock.calls[0][0]
  return 'data' in change ? (change.data as Record<string, unknown>) : {}
}

describe('scenario tools and the starting time', () => {
  it('shows the starting time the way the editor writes it', () => {
    expect(toScenarioDetails(scenario).startingTime).toBe('Y1 D3 21:00')
    expect(toScenarioDetails({ ...scenario, startingTime: null }).startingTime).toBeNull()
  })

  it('sets it on create', async () => {
    const { tools, onPendingChange } = setup()
    await run(tools.create_scenario, {
      name: 'New',
      description: null,
      settingSeed: 'x',
      primaryCharacterName: 'A',
      startingTime: 'Y2 D1 08:30',
    })
    expect(changeData(onPendingChange).startingTime).toEqual({
      years: 1,
      days: 0,
      hours: 8,
      minutes: 30,
    })
  })

  it('changes it on update, and leaves it alone when not given', async () => {
    const set = setup()
    await run(set.tools.update_scenario, { scenarioId: 's1', startingTime: 'Y1 D1 06:00' })
    expect(changeData(set.onPendingChange).startingTime).toEqual({
      years: 0,
      days: 0,
      hours: 6,
      minutes: 0,
    })

    const keep = setup()
    await run(keep.tools.update_scenario, { scenarioId: 's1', name: 'Renamed' })
    expect(changeData(keep.onPendingChange).startingTime).toEqual(scenario.startingTime)
  })

  it('clears it on update only with a blank string', async () => {
    const clear = setup()
    await run(clear.tools.update_scenario, { scenarioId: 's1', startingTime: '' })
    expect(changeData(clear.onPendingChange).startingTime).toBeNull()

    const keep = setup()
    await run(keep.tools.update_scenario, { scenarioId: 's1', name: 'x', startingTime: null })
    expect(changeData(keep.onPendingChange).startingTime).toEqual(scenario.startingTime)
  })

  it('shows the model the start as text in the tool result', async () => {
    const { tools } = setup()
    const result = (await run(tools.update_scenario, {
      scenarioId: 's1',
      startingTime: 'Y2 D1 08:30',
    })) as unknown as { pendingChange: { data: { startingTime: unknown } } }
    expect(result.pendingChange.data.startingTime).toBe('Y2 D1 08:30')
  })

  it('refuses text that is not a time rather than dropping it', async () => {
    const { tools, onPendingChange } = setup()
    const result = await run(tools.update_scenario, { scenarioId: 's1', startingTime: 'dusk' })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Y1 D1 19:00/)
    expect(onPendingChange).not.toHaveBeenCalled()
  })
})
