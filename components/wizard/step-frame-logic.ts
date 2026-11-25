import type { WizardWorkingState } from '@/lib/db'

type Mode = WizardWorkingState['definition']['mode']
type Narration = WizardWorkingState['definition']['narration']

export type { Mode, Narration }
