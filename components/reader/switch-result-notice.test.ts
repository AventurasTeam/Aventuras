import { describe, expect, it } from 'vitest'

import type { SwitchBranchResult } from '@/lib/actions'

import { switchResultNotice } from './switch-result-notice'

const GATE_REASON = 'Chapter close in progress. Cancel to edit.'

describe('switchResultNotice', () => {
  it.each<[string, SwitchBranchResult]>([
    ['a switch that landed', { status: 'ok' }],
    ['a switch the user abandoned by leaving', { status: 'abandoned' }],
    ['a press while another switch runs', { status: 'refused', code: 'running' }],
  ])('posts nothing for %s', (_name, result) => {
    expect(switchResultNotice(result, GATE_REASON)).toBeNull()
  })

  it.each<[string, SwitchBranchResult]>([
    ['the closed gate', { status: 'refused', code: 'gate' }],
    ['a turn body still active on the branch left', { status: 'refused', code: 'turn-body' }],
  ])("names the gate's reason for a refusal by %s", (_name, result) => {
    expect(switchResultNotice(result, GATE_REASON)).toStrictEqual({
      kind: 'info',
      message: GATE_REASON,
    })
  })

  it.each<[string, SwitchBranchResult]>([
    ['a branch missing from the story', { status: 'refused', code: 'missing' }],
    ['a load that failed', { status: 'failed', code: 'load' }],
    ['a stories re-read that failed', { status: 'failed', code: 'stories-reread' }],
    ['a stack reset that did not take', { status: 'failed', code: 'navigation-blocked' }],
  ])('reports %s as a failed switch', (_name, result) => {
    expect(switchResultNotice(result, GATE_REASON)).toStrictEqual({
      kind: 'error',
      message: "Couldn't switch branches.",
    })
  })
})
