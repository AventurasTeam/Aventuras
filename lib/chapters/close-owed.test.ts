import { describe, expect, it } from 'vitest'

import { isCloseOwed } from './close-owed'

const THRESHOLD = 1_000
const met = { tokens: 1_000, threshold: THRESHOLD, canClose: true }
const under = { tokens: 999, threshold: THRESHOLD, canClose: true }
const noReply = { tokens: 2_500, threshold: THRESHOLD, canClose: false }

// C10: a pending pick owes a close whatever the region; else auto-close at threshold with a reply.
describe('isCloseOwed', () => {
  it.each([
    { progress: met, autoClose: true, manualPending: false, owed: true },
    { progress: under, autoClose: true, manualPending: false, owed: false },
    { progress: noReply, autoClose: true, manualPending: false, owed: false },
    { progress: met, autoClose: false, manualPending: false, owed: false },
    { progress: under, autoClose: false, manualPending: true, owed: true },
    { progress: noReply, autoClose: false, manualPending: true, owed: true },
    { progress: met, autoClose: true, manualPending: true, owed: true },
  ])(
    '$progress.tokens tokens, canClose $progress.canClose, auto $autoClose, pick $manualPending → $owed',
    ({ progress, autoClose, manualPending, owed }) => {
      expect(isCloseOwed(progress, autoClose, manualPending)).toBe(owed)
    },
  )
})
