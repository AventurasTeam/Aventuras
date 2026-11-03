import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

export const APP_ID = 'com.aventuras.app'

export function adb(
  serial: string | undefined,
  args: string[],
  input?: string,
): SpawnSyncReturns<string> {
  const target = serial ? ['-s', serial] : []
  return spawnSync('adb', [...target, ...args], { encoding: 'utf8', input })
}
