// electron-builder re-collects node_modules with its own dependency walker,
// which drops packages that are only reachable as peerDependencies (the same
// pruning pnpm deploy does). The harness resolves plugins statically from the
// app's node_modules, so those packages must exist in the packed app. This
// hook re-runs the closure repair against the packed app directory, before
// the NSIS/DMG targets collect its content.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export default function afterPack(context) {
  const close = join(fileURLToPath(new URL('..', import.meta.url)), 'scripts', 'close-dependencies.mjs')
  execFileSync(process.execPath, [close, join(context.appOutDir, 'resources', 'app')], { stdio: 'inherit' })
}
