export type ClassifierLifecycleState = 'idle' | 'running' | 'failed'

export type ClassifierStatus = {
  state: ClassifierLifecycleState
  lastSuccessAt: number | null
  lastError: string | null
  processedThrough: number | null
}
