import type { WizardWorkingState } from '@/lib/db'

type Mode = WizardWorkingState['definition']['mode']
type Narration = WizardWorkingState['definition']['narration']

export function needsLead(mode: Mode, narration: Narration): boolean {
  return mode === 'adventure' || narration === 'first' || narration === 'second'
}

export type { Mode, Narration }
