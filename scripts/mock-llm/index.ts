import { startMockServer } from './server'
import { flushState, STATE_PATH } from './state'

export const DEFAULT_PORT = 4319

function resolvePort(): number {
  const flag = process.argv.indexOf('--port')
  const raw = flag !== -1 ? process.argv[flag + 1] : process.env.MOCK_LLM_PORT
  const port = raw !== undefined ? Number(raw) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${String(raw)}`)
  }
  return port
}

async function main(): Promise<void> {
  const port = resolvePort()
  const mock = await startMockServer(port)

  console.log('')
  console.log('  Aventuras mock LLM')
  console.log(`    endpoint    ${mock.url}`)
  console.log(`    control UI  ${mock.uiUrl}`)
  console.log(`    state       ${STATE_PATH}`)
  console.log('')
  console.log('  Point the app at the endpoint above (Settings → provider endpoint),')
  console.log('  or run `pnpm db:seed`, which seeds it already.')
  console.log('')

  const shutdown = (): void => {
    flushState(mock.ctx.state)
    void mock.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main().catch((err: unknown) => {
  console.error('[mock-llm] failed to start:', err)
  process.exit(1)
})
