/**
 * Update checking, on two platforms that share nothing but the question they ask.
 *
 * **Desktop** goes through `@tauri-apps/plugin-updater`: it reads the signed `latest.json`
 * published by `release.yml`, verifies it against the pubkey in `tauri.conf.json`, and can
 * download and install the new build itself.
 *
 * **Android cannot use any of that.** `tauri-plugin-updater` declares Android support level
 * `none`, and its `updater_os()` has no `target_os = "android"` branch -- so `check()` fails
 * with `UnsupportedOs` before a single request goes out. There is no in-app install path
 * either: an APK is installed by the system package installer, not by the app it replaces.
 * The Android path therefore reads the GitHub Releases API directly, compares the tag with
 * `getVersion()` itself, and hands the user a URL to open. `canInstallInApp` is what tells
 * the UI which of the two it is looking at.
 *
 * Both paths resolve the *same* release: `/releases/latest` on the API excludes drafts and
 * pre-releases, exactly as `/releases/latest/download/latest.json` does for the desktop
 * endpoint. A release that is still a draft is invisible to both, which is the intended
 * behaviour -- see the README's release section.
 *
 * One desktop install format opts out of installing in place: a `.deb` is sent to the
 * releases page instead. `manualInstallReason` distinguishes that from the Android case,
 * because the two need different explanations in front of the user.
 */

import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { fetch as tauriHttpFetch } from '@tauri-apps/plugin-http'
import { getVersion, getBundleType, type BundleType } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { isAndroid } from '$lib/utils/platform'
import { isNewerVersion } from '$lib/utils/version'

/**
 * The repository the release workflow publishes to. Must stay in step with the `updater`
 * endpoint in `src-tauri/tauri.conf.json`, or the two platforms will offer different
 * versions of the app to their users.
 */
const RELEASE_REPO = 'AventurasTeam/Aventuras'
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`

/** How long the Android check waits before giving up, so a dead network cannot hang startup. */
const GITHUB_TIMEOUT_MS = 15_000

/**
 * Why the app is not installing this update itself. Absent when it is.
 *
 * The two cases need different words in front of the user -- one is about the device, the
 * other about how this particular copy was installed -- so the reason travels with the
 * update rather than being re-derived in the component.
 */
export type ManualInstallReason = 'mobile-platform' | 'deb-package' | 'unpackaged'

export interface UpdateInfo {
  available: boolean
  version?: string
  currentVersion?: string
  body?: string
  date?: string
  /**
   * Where to send the user when the app cannot install the update itself: the `.apk` asset
   * on Android, the releases page for a `.deb` install.
   */
  downloadUrl?: string
  /**
   * Whether `downloadAndInstall` is usable for this update. See `manualInstallReason` for
   * the cases where it is not.
   */
  canInstallInApp: boolean
  /** Set exactly when `canInstallInApp` is false. */
  manualInstallReason?: ManualInstallReason
}

export interface UpdateProgress {
  downloaded: number
  total: number | null
}

/** Why a check or install failed, in the terms the UI needs to phrase it. */
export type UpdateErrorKind =
  | 'unsupported' // this platform/install format cannot self-update
  | 'no-release' // the endpoint has no published release (e.g. the draft was never published)
  | 'network' // could not reach the endpoint
  | 'unknown'

export class UpdateError extends Error {
  constructor(
    readonly kind: UpdateErrorKind,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'UpdateError'
  }
}

/** Shape of the bits of the GitHub release payload this reads. */
interface GitHubRelease {
  tag_name?: string
  name?: string
  body?: string | null
  published_at?: string | null
  html_url?: string
  assets?: { name?: string; browser_download_url?: string }[]
}

function classifyError(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error

  const message = error instanceof Error ? error.message : String(error)

  // The plugin's own errors arrive as plain strings over the IPC bridge.
  if (/UnsupportedOs|UnsupportedArch|not supported/i.test(message)) {
    return new UpdateError(
      'unsupported',
      'Automatic updates are not supported on this platform.',
      error,
    )
  }
  if (/ReleaseNotFound|release not found/i.test(message)) {
    return new UpdateError(
      'no-release',
      'No published release was found. If a release was just built, it may still be a draft.',
      error,
    )
  }
  if (/network|timeout|timed out|dns|connect|unreachable|failed to fetch/i.test(message)) {
    return new UpdateError('network', 'Could not reach the update server.', error)
  }

  return new UpdateError('unknown', message || 'The update check failed.', error)
}

class UpdaterService {
  private updateAvailable: Update | null = null
  private downloading = false
  private progress: UpdateProgress | null = null
  /** Kept so the Android path can answer `getUpdateInfo()` like the desktop one does. */
  private lastInfo: UpdateInfo | null = null
  /**
   * The check currently in flight, shared by every concurrent caller.
   *
   * The startup check and the Settings button really do race: a user who opens Settings
   * during startup and presses the button would otherwise get an answer about no request
   * at all, and "You're up to date!" is a specific, wrong thing to say about a check that
   * has not come back yet. Joining the running check answers both callers correctly.
   */
  private inFlight: Promise<UpdateInfo> | null = null

  /**
   * Checks for an available update on whichever path this platform has.
   *
   * Throws an `UpdateError` on failure rather than returning `{ available: false }`, so a
   * caller can tell "there is no update" from "we could not find out".
   */
  checkForUpdates(): Promise<UpdateInfo> {
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async runCheck(): Promise<UpdateInfo> {
    try {
      const info = isAndroid() ? await this.checkViaGitHub() : await this.checkViaTauri()
      this.lastInfo = info
      return info
    } catch (error) {
      this.updateAvailable = null
      this.lastInfo = null
      const classified = classifyError(error)
      console.error('[Updater] Check failed:', classified.kind, classified.message)
      throw classified
    }
  }

  /**
   * How this copy of the app was packaged, or `null` when it was not packaged at all.
   *
   * Tauri types this as `Promise<BundleType>`, but the Rust command returns an `Option`.
   * The value comes from a placeholder the bundler patches into the binary at bundle time,
   * so a `tauri dev` build -- never bundled -- yields `null` on Linux and Windows.
   */
  private async bundleType(): Promise<BundleType | null> {
    try {
      return (await getBundleType()) ?? null
    } catch (error) {
      console.error('[Updater] Could not determine the bundle type:', error)
      return null
    }
  }

  /** Desktop: the signed `latest.json` flow, handled entirely by the plugin. */
  private async checkViaTauri(): Promise<UpdateInfo> {
    const update = await check()

    if (!update) {
      this.updateAvailable = null
      return { available: false, canInstallInApp: true }
    }

    this.updateAvailable = update

    const bundle = await this.bundleType()

    // Two desktop cases hand off to the browser instead of installing in place.
    //
    // `null` means the app was never bundled -- a `tauri dev` build. Installing there is
    // actively destructive: on Linux the plugin's `extract_path` *is* the running
    // executable, so `install_appimage` moves the freshly built dev binary into a
    // `TempDir`, writes the release AppImage over it, and then drops the `TempDir`,
    // deleting the backup. The developer is left with a 100 MB AppImage where their build
    // was, and the plugin reports success.
    //
    // A `.deb` is a decision rather than a hazard: `install_deb` shells out to `dpkg -i`
    // through `pkexec`, falling back to zenity/kdialog and finally to a terminal `sudo`
    // that a windowed app has no terminal for. Too many ways to end half-finished, and
    // the package manager owns that install anyway.
    const reason: ManualInstallReason | undefined =
      bundle === null ? 'unpackaged' : bundle === 'deb' ? 'deb-package' : undefined

    // Prefer GitHub's release body over `latest.json`'s `notes`. See `releaseNotesFor`.
    const notes = (await this.releaseNotesFor(update.version)) ?? update.body ?? undefined

    return {
      available: true,
      version: update.version,
      currentVersion: update.currentVersion,
      body: notes,
      date: update.date ?? undefined,
      canInstallInApp: reason === undefined,
      manualInstallReason: reason,
      downloadUrl: reason ? RELEASES_PAGE : undefined,
    }
  }

  /**
   * Fetches the latest published release from the GitHub API.
   *
   * Shared by both paths. Android needs it to find an update at all; desktop needs it only
   * for the release notes, because `latest.json` carries the workflow's static
   * `releaseBody` rather than what the maintainer writes on the release afterwards.
   */
  private async fetchLatestRelease(): Promise<GitHubRelease> {
    // AbortController rather than `AbortSignal.timeout`, which the older Android System
    // WebViews this app still runs on do not implement. Matches the rest of the codebase.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), GITHUB_TIMEOUT_MS)

    let response: Response
    try {
      response = await tauriHttpFetch(LATEST_RELEASE_API, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: ctrl.signal,
      })
    } catch (error) {
      // An aborted fetch reads as a generic DOMException, so name the real cause here
      // rather than letting `classifyError` guess at it.
      throw ctrl.signal.aborted
        ? new UpdateError('network', 'The update check timed out.', error)
        : error
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 404) {
      throw new UpdateError(
        'no-release',
        'No published release was found. If a release was just built, it may still be a draft.',
      )
    }
    if (!response.ok) {
      throw new UpdateError(
        response.status === 403 ? 'network' : 'unknown',
        `GitHub returned ${response.status} while checking for updates.`,
      )
    }

    return (await response.json()) as GitHubRelease
  }

  /**
   * The release notes GitHub holds for `version`, or `undefined`.
   *
   * `latest.json` is written by `tauri-action` at build time, so its `notes` are the
   * workflow's fixed `releaseBody` string -- the real notes are written on the release
   * afterwards and never reach that file. Reading them here means editing the release on
   * GitHub updates what every client shows, with no rebuild.
   *
   * Only used when the tag matches the update being offered: notes belonging to a
   * different version are worse than none, and the two files can disagree.
   *
   * Never throws. The update is signed and installable whatever happened here.
   */
  private async releaseNotesFor(version: string): Promise<string | undefined> {
    try {
      const release = await this.fetchLatestRelease()
      const tag = release.tag_name?.trim().replace(/^v/, '')
      if (!tag || tag !== version.replace(/^v/, '')) return undefined
      return release.body?.trim() || undefined
    } catch (error) {
      console.error('[Updater] Could not fetch release notes:', error)
      return undefined
    }
  }

  /** Android: read the release list ourselves and compare the tag with the running build. */
  private async checkViaGitHub(): Promise<UpdateInfo> {
    this.updateAvailable = null

    const currentVersion = await getVersion()
    const release = await this.fetchLatestRelease()
    const tag = release.tag_name?.trim()

    if (!tag) {
      throw new UpdateError('no-release', 'The latest release has no version tag.')
    }
    if (!isNewerVersion(tag, currentVersion)) {
      return { available: false, currentVersion, canInstallInApp: false }
    }

    // Prefer the APK itself; fall back to the release page so the user is never left
    // without somewhere to go when the asset is named unexpectedly.
    const apk = release.assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk'))

    return {
      available: true,
      version: tag.replace(/^v/, ''),
      currentVersion,
      body: release.body ?? undefined,
      date: release.published_at ?? undefined,
      downloadUrl: apk?.browser_download_url ?? release.html_url ?? RELEASES_PAGE,
      canInstallInApp: false,
      manualInstallReason: 'mobile-platform',
    }
  }

  /**
   * Opens the update's download in the system browser.
   *
   * The Android counterpart of `downloadAndInstall`: the browser downloads the APK and
   * Android's own package installer takes it from there.
   */
  async openDownloadPage(): Promise<void> {
    await openUrl(this.lastInfo?.downloadUrl ?? RELEASES_PAGE)
  }

  /**
   * Downloads and installs the available update. Returns `false` when there is nothing
   * staged, a download is already running, or this build must not install over itself.
   *
   * That last condition is enforced here rather than only in the dialog. Android happens to
   * be covered already -- `checkViaGitHub` leaves `updateAvailable` null -- but a `.deb`
   * install and an unpackaged dev build both reach this with a real `Update` staged, and
   * for the dev build installing is destructive (see `checkViaTauri`). Leaving that to the
   * caller makes a UI branch the only thing standing between a second caller and a deleted
   * binary.
   */
  async downloadAndInstall(onProgress?: (progress: UpdateProgress) => void): Promise<boolean> {
    if (!this.updateAvailable || this.downloading || !this.lastInfo?.canInstallInApp) {
      return false
    }

    this.downloading = true
    this.progress = { downloaded: 0, total: null }

    try {
      await this.updateAvailable.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            this.progress = {
              downloaded: 0,
              total: event.data.contentLength ?? null,
            }
            break
          case 'Progress':
            if (this.progress) {
              this.progress.downloaded += event.data.chunkLength
            }
            break
          case 'Finished':
            // Download complete; the installer runs next.
            break
        }

        if (onProgress && this.progress) {
          onProgress({ ...this.progress })
        }
      })

      return true
    } catch (error) {
      const classified = classifyError(error)
      console.error('[Updater] Download/install failed:', classified.kind, classified.message)
      throw classified
    } finally {
      this.downloading = false
      this.progress = null
    }
  }

  /** Relaunches the app after an install. */
  async relaunch(): Promise<void> {
    try {
      await relaunch()
    } catch (error) {
      console.error('[Updater] Relaunch failed:', error)
    }
  }

  isChecking(): boolean {
    return this.inFlight !== null
  }

  isDownloading(): boolean {
    return this.downloading
  }

  getProgress(): UpdateProgress | null {
    return this.progress
  }

  hasUpdate(): boolean {
    return this.lastInfo?.available === true
  }

  getUpdateInfo(): UpdateInfo | null {
    return this.lastInfo?.available ? this.lastInfo : null
  }
}

export const updaterService = new UpdaterService()
export { RELEASES_PAGE }
