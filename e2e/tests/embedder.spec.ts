import { expect, test } from '@playwright/test'

import { installEmbedderModel } from '../harness/embedder'
import { launchApp, type LaunchedApp } from '../harness/launch'
import { createSeededUserDataDir, removeUserDataDir } from '../harness/seed'

type SmokeResult = { ok: true; dim: number } | { ok: false; error: unknown }
type Installed = { id: string; installedAt: number; sizeBytes: number }

// The evaluate callbacks run in the renderer, reaching the embedder bridge the
// Electron preload exposes (window.aventurasEmbedder) — so each call crosses
// the real renderer → IPC → main → transformers.js path. The bridge type is
// declared inline in each callback because the function is serialized into the
// page, not closed over from here.
test.describe('local embedder', () => {
  let app: LaunchedApp
  let userDataDir: string | undefined
  let modelId: string
  let expectedDim: number

  test.beforeAll(async () => {
    // Cold cache downloads ~24 MB from Hugging Face before launch.
    test.setTimeout(180_000)
    ;({ userDataDir } = createSeededUserDataDir())
    ;({ modelId, dim: expectedDim } = await installEmbedderModel(userDataDir))
    app = await launchApp({ userDataDir, cleanupUserData: true })
  })

  test.afterAll(async () => {
    await app?.close()
    removeUserDataDir(userDataDir)
  })

  test('lists the seeded model as installed', async () => {
    const installed = await app.window.evaluate(() =>
      (
        window as unknown as { aventurasEmbedder: { listInstalled: () => Promise<Installed[]> } }
      ).aventurasEmbedder.listInstalled(),
    )
    expect(installed.map((m) => m.id)).toContain(modelId)
  })

  test('embeds through the real IPC → main → onnxruntime path', async () => {
    const result = await app.window.evaluate(
      (id) =>
        (
          window as unknown as {
            aventurasEmbedder: { smokeTest: (a: { modelId: string }) => Promise<SmokeResult> }
          }
        ).aventurasEmbedder.smokeTest({ modelId: id }),
      modelId,
    )
    expect(result.ok, JSON.stringify(result)).toBe(true)
    expect((result as { dim: number }).dim).toBe(expectedDim)
  })
})
