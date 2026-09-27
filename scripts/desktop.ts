import concurrently from 'concurrently'

import { resolveDevSlot } from './dev-slot/resolve'

// `pnpm desktop`: Expo web on the slot's Metro port, then Electron loading it. Slot 0 is the
// plain dev app; a worker slot also gets its own DevTools port and userData, and no detached
// DevTools window, which would otherwise be the first page an MCP client attaches to.
const { slot, ports, dataDir } = resolveDevSlot()
const web = `http://localhost:${ports.metro}`
const electronArgs =
  slot === 0
    ? []
    : [
        `--remote-debugging-port=${ports.devtools}`,
        `--user-data-dir=${JSON.stringify(dataDir)}`,
        '--aventuras-no-devtools-window',
      ]

const { result } = concurrently(
  [
    {
      name: 'expo',
      command: `expo start --web --port ${ports.metro}`,
      env: { BROWSER: 'none' },
      prefixColor: 'blue',
    },
    {
      name: 'electron',
      command: [
        `wait-on ${web}`,
        'pnpm electron:compile',
        ['electron electron/dist/main.js', ...electronArgs].join(' '),
      ].join(' && '),
      env: { EXPO_WEB_URL: web },
      prefixColor: 'magenta',
    },
  ],
  { killOthersOn: ['failure', 'success'] },
)

result.then(
  () => process.exit(0),
  () => process.exit(1),
)
