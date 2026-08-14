/**
 * Carrier swap proposal: how the shipped browser plugin selects the desktop
 * IPC carrier. NOT wired — this file documents the exact change and provides
 * the factory the connection package would call.
 *
 * Today `packages/client/connection/src/client/index.ts` pins the transport
 * at boot:
 *
 *   const api: IApiClient = fixtureClient ?? new WebApiClient()
 *
 * The desktop renderer must instead construct {@link ElectronApiClient} over
 * the preload bridge. Two sanctioned routes (the layering note's
 * "transport swap (Electron IPC carrier)" reservation):
 *
 * 1. A boot-time transport selector in the connection client apply — the
 *    shell (or a desktop preload bootstrap) publishes a transport fact the
 *    plugin reads, e.g. a `window.__DSH_TRANSPORT__ = 'ipc'` marker, and the
 *    apply chooses `new ElectronApiClient(window.dshApi)` accordingly.
 * 2. A connection-Config seam (the package already has `ConnectionConfig`
 *    knobs), where the desktop composition patches the connection row with a
 *    transport option; the row's browser half and the shell agree through a
 *    typed boot value.
 *
 * Whichever route is chosen, the factory below is the unit that graduates
 * into the connection package; the base class contract stays unchanged.
 *
 * @module @deepseek-ai/dsh-desktop/renderer/carrier
 */

import { ElectronApiClient } from './electron-api-client.ts'
import type { DshApiBridge } from '../shared/dsh-api.ts'

/** The preload bridge under its published window key. */
export interface DshWindow {
  dshApi?: DshApiBridge
}

/**
 * Build the IPC carrier when the preload bridge is present, else undefined.
 * The connection apply would fall back to `WebApiClient` when this returns
 * undefined (non-desktop pages).
 * @param bridge - the bridge to drive, or undefined on a plain browser page.
 * @returns the IPC client, or undefined when no bridge exists.
 */
export function createElectronApiClient(bridge: DshApiBridge | undefined): ElectronApiClient | undefined {
  return bridge === undefined ? undefined : new ElectronApiClient(bridge)
}
