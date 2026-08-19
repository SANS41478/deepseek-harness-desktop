/**
 * Desktop host assembly: boot the DeepSeek Harness `web` profile inside the
 * Electron main process, exactly as the `dsh` CLI boots it (same profile,
 * bundle layers, user patch layers, and fail-loud guards), then surface the
 * loopback URL of the in-process web server. The desktop never opens a port
 * beyond loopback; the server exists to host the browser transport in
 * loopback mode and to anchor the `webServer` service the client-modules
 * node half requires (see the README for the follow-up that relaxes that
 * dependency).
 *
 * This module is Electron-free by design: it is plain Node boot glue and can
 * be exercised by tests without a window.
 * @module @deepseek-ai/dsh-desktop/main/start-host
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const NAME = 'dsh-desktop'

/** Absolute path of this app's package.json (src/main/ and lib/main/ both sit two levels under apps/desktop). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/**
 * Shipped agent-preset roster, beside this app's own config in both the source
 * and built layouts (src/main/ and lib/main/ both sit two levels under
 * apps/desktop). The writable root the roster appends is `dsh-agent-presets`'
 * own, so a launcher that never reaches this patch still finds a person's
 * presets.
 */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../../config/agent-presets/', import.meta.url))

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets (mirror of apps/cli). */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over (mirror of apps/cli). */
const PROFILE_ROOT_CONFIG = `# dsh desktop profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# desktop overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory (mirror of apps/cli). */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The home-level user patch layer, applied over every profile's own layer. */
function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Options for {@link startHost}. */
export interface StartHostOptions {
  /** The profile to boot; the `web` template is the desktop's shipped surface. */
  profile?: string
  /**
   * The invocation's inner arguments, handed to the tree through
   * `ctx.cmdlineArgs`; the web-startup provider parses `--port` from them.
   */
  args?: readonly string[]
  /**
   * Bounded exit request for `ctx.appExit`; an Electron assembly passes a
   * callback that quits the app.
   */
  onExit?: (code: number) => void
  /**
   * Whether the composition must mount the HTTP `webServer` service. The
   * loopback transport needs it (the window loads the served dist); the IPC
   * transport serves dist and bundles over `dsh://` and disables the
   * webserver row instead.
   */
  webServerRequired?: boolean
}

/** The settled desktop host: the booted tree and its loopback web URL. */
export interface DesktopHost {
  /** The settled root context. */
  ctx: Context
  /**
   * The loopback URL of the in-process web server (loopback transport only;
   * absent on the IPC transport, which serves over `dsh://`).
   */
  webUrl?: string
  /** Dispose the whole tree to quiescence (the app's teardown path). */
  dispose(): Promise<void>
}

/**
 * Boot the desktop's profile end to end and return the settled tree.
 * @param options - profile name, inner arguments, and the app's exit callback.
 * @returns the settled context plus the loopback URL and a disposer.
 */
export async function startHost(options: StartHostOptions = {}): Promise<DesktopHost> {
  const profileName = options.profile ?? 'web'
  const webServerRequired = options.webServerRequired ?? true
  const args = options.args ?? []
  const environment = loadLayeredEnv(NAME)

  const app: { current?: Context } = {}
  let exiting = false
  const disposeTree = async (): Promise<void> => { await app.current?.fiber.dispose() }
  installFailLoud(NAME, process, disposeTree)

  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, profileName, INSTALL_ANCHOR)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)

  const composed = composeProfile(profile)
  // The IPC transport carries dist and bundles over dsh:// and needs no HTTP
  // server: disable the webserver row so the tree mounts carrier-free. The
  // directory-picker auto row keys off the webserver bind host, which no
  // longer exists, so the IPC tree pins the Electron interaction directly
  // (Electron's own dialog backend + the native client surface) as the auto
  // row's own comment prescribes.
  const webServerPatch: PatchOptions[] = webServerRequired
    ? []
    : [
      { id: 'webserver', disabled: true },
      { id: 'directory-picker', disabled: true },
      {
        insert: [
          { id: 'directory-picker-electron', name: '@deepseek-ai/dsh-desktop/directory-picker' },
          { id: 'ui-directory-picker-native', name: '@deepseek-ai/dsh-client-ui-directory-picker-native' },
        ],
      },
    ]
  // The boot applies the full stack — bundle, user, home layers, then the
  // overlays (shipped agent-presets roster, telemetry switch) and the
  // transport patch — in application order, mirroring the CLI's `allPatches`.
  // The separate `overlays` value is the HMR composeLive layer and keeps the
  // transport patch so a live reload preserves the transport.
  const patches = [...composed.patches, ...composed.overlays, ...webServerPatch]
  const overlays = [...composed.overlays, ...webServerPatch]
  const ctx = await boot(NAME, join(profile.dir, PROFILE_ROOT_FILENAME), structuredClone(patches), (hostCtx) => {
    app.current = hostCtx
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    provideCmdline(hostCtx, {
      args,
      exit: (code) => {
        if (exiting) return
        exiting = true
        if (options.onExit !== undefined) options.onExit(code)
        else void disposeTree().finally(() => process.exit(code))
      },
    })
  })
  app.current = ctx

  if (ctx.fiber.state === FiberState.ACTIVE && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live user patch layers, mirroring the CLI:
      // a long-lived desktop surface keeps cordis.patch.yml edits live. Both
      // files are re-read per generation so editing one never drops the other
      // (and fresh clones keep insert-aliasing out of the mounted tree).
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      const composeLive = (): PatchOptions[] => structuredClone([
        ...composed.bundlePatches,
        ...loadOptionalPatches(NAME, profile.patchPath) ?? [],
        ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
        ...overlays,
      ])
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      // A surface can dispose the whole tree while the watcher opens; the
      // shutdown path owns that outcome, so a stale setup failure is a warn.
      ctx.logger.warn(`dsh-desktop: user patch watching failed: ${String(error)}`)
    }
  }

  const webServer = ctx.get('webServer') as { port?: number } | undefined
  const port = webServer?.port
  if (webServerRequired && port === undefined) {
    throw new Error(`dsh-desktop: profile "${profileName}" mounted no webServer service — the loopback transport requires the web composition`)
  }
  return {
    ctx,
    ...port !== undefined ? { webUrl: `http://127.0.0.1:${String(port)}` } : {},
    dispose: () => disposeTree(),
  }
}

/** The profile's patch stack in application order (bundle layers, user layer, home layer, overlays). */
interface ComposedProfile {
  bundlePatches: PatchOptions[]
  patches: PatchOptions[]
  overlays: PatchOptions[]
}

/**
 * Compose the effective patch stack for the desktop boot: bundle layers in
 * `dsh.profile.bundles` order, the profile's user layer, the home-level user
 * layer, then the telemetry switch.
 * @param profile - the loaded profile.
 * @returns the layers in application order.
 */
function composeProfile(profile: Profile): ComposedProfile {
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const userPatches = profile.patches
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const rows = new Map<string, unknown>()
  for (const row of composeEntries([bundlePatches, userPatches, homePatches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlays: PatchOptions[] = []
  // The shipped roster is the part of the preset set only this app can resolve:
  // it sits beside this app's own config (mirror of apps/cli's profile-boot).
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets') as { config?: Record<string, unknown> } | undefined)?.config ?? {},
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  // Privacy switch: ANY non-empty value disables; a composition without the
  // row needs no patch (mirror of apps/cli).
  if ((process.env.DSH_TELEMETRY_DISABLED ?? '') !== '' && rows.has(TELEMETRY_ROW_ID)) {
    overlays.push({ id: TELEMETRY_ROW_ID, disabled: true })
  }
  return { bundlePatches, patches: [...bundlePatches, ...userPatches, ...homePatches], overlays }
}
