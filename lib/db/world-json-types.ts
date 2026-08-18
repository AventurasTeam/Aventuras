export type ClassifierLifecycleState = 'idle' | 'running' | 'retrying' | 'failed-persistent'

export type ClassifierStatus = {
  state: ClassifierLifecycleState
  lastSuccessAt: number | null
  lastError: string | null
  retryCount: number
  processedThrough: number | null
}
