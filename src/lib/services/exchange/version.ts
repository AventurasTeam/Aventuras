import { EXCHANGE_FORMAT_VERSION } from './types'

export type VersionCheck = { ok: true; warning: string | null } | { ok: false; error: string }

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function majorMinor(version: string): [number, number] | null {
  const match = SEMVER.exec(version)
  return match ? [Number(match[1]), Number(match[2])] : null
}

export function checkFormatVersion(fileVersion: string): VersionCheck {
  const file = majorMinor(fileVersion)
  if (!file) {
    return { ok: false, error: `Invalid Aventuras format version "${fileVersion}".` }
  }
  const [appMajor, appMinor] = majorMinor(EXCHANGE_FORMAT_VERSION)!
  const [fileMajor, fileMinor] = file
  if (fileMajor > appMajor) {
    return {
      ok: false,
      error: `This file uses Aventuras format ${fileVersion}, which this version of the app does not support. Update Aventuras to import it.`,
    }
  }
  if (fileMajor === appMajor && fileMinor > appMinor) {
    return {
      ok: true,
      warning: `This file was written by a newer version of Aventuras (format ${fileVersion}). Fields this version does not know were ignored.`,
    }
  }
  return { ok: true, warning: null }
}
