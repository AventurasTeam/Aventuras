import { ensureEmbedderModel } from './harness/embedder'

// Once, before any worker: on a cold cache, workers provisioning it themselves would delete the
// directory another is copying from.
export default async function globalSetup(): Promise<void> {
  await ensureEmbedderModel()
}
