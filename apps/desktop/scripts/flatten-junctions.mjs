// Replace node_modules junctions that point outside the staging directory
// (pnpm deploy keeps `link:` workspace overrides — cosmokit, schemastery —
// as junctions to the repository) with real directory copies, so
// electron-builder's asar packaging never resolves a path outside the app.
// Windows junctions are reported as symbolic links by Node's directory
// entries, so detection walks the tree with readdirSync and resolves each
// link's real target — no shelling out to PowerShell, which would mangle
// non-ASCII paths through the OEM code page.
import { cpSync, existsSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const staging = resolve(process.argv[2] ?? '')
if (!staging || !existsSync(staging)) {
  throw new Error('flatten-junctions: pass the staging directory')
}

/** List of junction paths (and their resolved targets) under `root`. */
function listJunctions(root) {
  const junctions = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      // Unreadable or concurrently-removed directory; nothing to flatten.
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        junctions.push({ path: full, target: realpathSync(full) })
        continue
      }
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(root)
  return junctions
}

const stagingRoot = resolve(staging)
// The app package itself: lib/ is staged separately, and copying the
// junction target would drag the whole repository checkout into the asar.
const appPackageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
let copied = 0
for (const { path, target } of listJunctions(join(staging, 'node_modules'))) {
  const resolvedTarget = resolve(target)
  if (resolvedTarget.startsWith(stagingRoot)) continue
  if (resolvedTarget === appPackageRoot || resolvedTarget.startsWith(appPackageRoot + '\\')) {
    // The app package's own self-link (pnpm deploy links it into the virtual
    // store): the app is the packaged root, not a dependency. Remove it so
    // packaging never follows it back into the repository checkout.
    console.log(`flatten-junctions: removing self-link ${path}`)
    rmSync(path, { recursive: true, force: true })
    continue
  }
  console.log(`flatten-junctions: copying ${path} <- ${target}`)
  rmSync(path, { recursive: true, force: true })
  cpSync(target, path, { recursive: true, force: true })
  copied += 1
}
console.log(`flatten-junctions: done (${copied} replaced)`)
