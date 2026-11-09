import { parseArgs } from 'node:util'

// Strict: an ignored typo would seed something other than what was asked for.
export function parseCli(argv: string[]): {
  path: string | undefined
  longBranch: boolean
  dataset: boolean
  overlay: boolean
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      'long-branch': { type: 'boolean', default: false },
      dataset: { type: 'boolean', default: false },
      overlay: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })
  if (positionals.length > 1) {
    throw new Error(
      `one database path at most, got ${positionals.length}: ${positionals.join(' ')}`,
    )
  }
  if (values.overlay && !values.dataset)
    throw new Error('--overlay goes on the dataset seed: pnpm db:seed:dataset --overlay')
  return {
    path: positionals[0],
    longBranch: values['long-branch'],
    dataset: values.dataset,
    overlay: values.overlay,
  }
}
